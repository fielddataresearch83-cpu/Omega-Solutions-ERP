import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EmployeesService } from './employees.service.js';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

describe('EmployeesService',()=>{
 const user:AuthenticatedUser={userId:'user-1',email:'owner@example.test',fullName:'Owner',companyId:'company-1',branchId:null,role:'owner',permissions:['employees:read','employees:write']};
 let db:{query:ReturnType<typeof vi.fn>;transaction:ReturnType<typeof vi.fn>};
 let memberships:{getMembership:ReturnType<typeof vi.fn>;getMembershipForCompany:ReturnType<typeof vi.fn>};
 let audit:{log:ReturnType<typeof vi.fn>};
 let service:EmployeesService;
 beforeEach(()=>{
  db={query:vi.fn(),transaction:vi.fn()};
  db.transaction.mockImplementation(async(callback:(client:unknown)=>Promise<unknown>)=>callback({query:db.query}));
  const membership={companyId:'company-1',branchId:null,role:'owner'};
  memberships={getMembership:vi.fn().mockResolvedValue(membership),getMembershipForCompany:vi.fn().mockResolvedValue(membership)};
  audit={log:vi.fn().mockResolvedValue(undefined)};
  service=new EmployeesService(db as unknown as DatabaseService,memberships as unknown as MembershipsService,audit as unknown as AuditService);
 });
 it('updates a national ID only within the active company and masks it in the response',async()=>{
  db.query.mockResolvedValue({rows:[{id:'employee-1',employee_number:'EMP-1',first_name:'Amina',last_name:'Otieno',updated_at:'2026-10-15'}],rowCount:1});
  const result=await service.updateNationalId(user,'employee-1','12 345-678');
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE id=$1 AND company_id=$2'),['employee-1','company-1','12345678',null]);
  expect(result.nationalIdMasked).toBe('••••5678');
  expect(JSON.stringify(result)).not.toContain('12345678');
  expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({action:'employees.national_id.update',newValues:{nationalIdLast4:'5678'}}));
 });
 it('rejects invalid national ID values before writing them',async()=>{
  await expect(service.updateNationalId(user,'employee-1','abc')).rejects.toThrow(BadRequestException);
  expect(db.query).not.toHaveBeenCalled();
 });
 it('rejects malformed KRA PIN before writing an employee record',async()=>{
  await expect(service.create(user,{employeeNumber:'EMP-2',firstName:'Amina',lastName:'Otieno',kraPin:'not-a-pin'})).rejects.toThrow(BadRequestException);
  expect(db.query).not.toHaveBeenCalled();
  expect(audit.log).not.toHaveBeenCalled();
 });
 it('lists employees only within the active company',async()=>{
  db.query.mockResolvedValue({rows:[],rowCount:0});
  await service.list(user);
  expect(memberships.getMembershipForCompany).toHaveBeenCalledWith('user-1','company-1');
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE e.company_id=$1 AND ($2::uuid IS NULL OR e.branch_id=$2)'),['company-1',null]);
 });

 it('limits employee listing to the membership branch for branch-restricted users',async()=>{
  const branchUser={...user,branchId:'branch-1',role:'staff'};
  memberships.getMembershipForCompany.mockResolvedValue({companyId:'company-1',branchId:'branch-1',role:'staff'});
  db.query.mockResolvedValue({rows:[],rowCount:0});
  await service.list(branchUser);
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('e.branch_id=$2'),['company-1','branch-1']);
 });
 it('does not let branch-restricted users create employees in another branch',async()=>{
  const branchUser={...user,branchId:'branch-1',role:'staff'};
  memberships.getMembershipForCompany.mockResolvedValue({companyId:'company-1',branchId:'branch-1',role:'staff'});
  await expect(service.create(branchUser,{employeeNumber:'EMP-3',firstName:'Amina',lastName:'Otieno',branchId:'branch-2'})).rejects.toThrow(BadRequestException);
  expect(db.query).not.toHaveBeenCalled();
 });
 it('rejects a branch from another company before creating an employee',async()=>{
  db.query.mockResolvedValue({rows:[],rowCount:0});
  await expect(service.create(user,{employeeNumber:'EMP-1',firstName:'Amina',lastName:'Otieno',branchId:'foreign-branch'})).rejects.toThrow(BadRequestException);
  expect(db.query).toHaveBeenCalledTimes(1);
  expect(audit.log).not.toHaveBeenCalled();
 });
 it('rejects overlapping pending or approved leave requests',async()=>{
  const client={query:vi.fn().mockImplementation(async(sql:string)=>{
   if(sql.includes('SELECT id FROM employees'))return {rows:[{id:'employee-1'}],rowCount:1};
   if(sql.includes('SELECT id FROM employee_leave_requests'))return {rows:[{id:'existing-leave'}],rowCount:1};
   return {rows:[],rowCount:1};
  })};
  db.transaction.mockImplementation(async(callback:(client:unknown)=>Promise<unknown>)=>callback(client));
  await expect(service.createLeaveRequest(user,{employeeId:'employee-1',leaveType:'annual',startDate:'2026-11-02',endDate:'2026-11-05'})).rejects.toThrow(ConflictException);
  expect(client.query).toHaveBeenCalledTimes(2);
  expect(audit.log).not.toHaveBeenCalled();
 });
 it('rejects leave requests whose end date precedes their start date',async()=>{
  await expect(service.createLeaveRequest(user,{employeeId:'employee-1',leaveType:'annual',startDate:'2026-11-05',endDate:'2026-11-02'})).rejects.toThrow(BadRequestException);
  expect(db.transaction).not.toHaveBeenCalled();
 });
 it('does not review a leave request twice',async()=>{
  db.query.mockResolvedValueOnce({rows:[],rowCount:0}).mockResolvedValueOnce({rows:[{id:'leave-1'}],rowCount:1});
  await expect(service.reviewLeaveRequest(user,'leave-1',{status:'approved'})).rejects.toThrow(ConflictException);
  expect(audit.log).not.toHaveBeenCalled();
 });
 it('returns not found for a leave request in another company',async()=>{
  db.query.mockResolvedValueOnce({rows:[],rowCount:0}).mockResolvedValueOnce({rows:[],rowCount:0});
  await expect(service.reviewLeaveRequest(user,'foreign-leave',{status:'approved'})).rejects.toThrow(NotFoundException);
 });
 it('prevents inactive or terminated employees from requesting leave',async()=>{
  db.query.mockResolvedValue({rows:[],rowCount:0});
  await expect(service.createLeaveRequest(user,{employeeId:'employee-terminated',leaveType:'annual',startDate:'2026-11-02',endDate:'2026-11-05'})).rejects.toThrow(NotFoundException);
  expect(db.query.mock.calls[0][0]).toContain("employment_status NOT IN ('terminated','inactive')");
  expect(audit.log).not.toHaveBeenCalled();
 });

});
