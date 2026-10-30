import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ExpensesService } from './expenses.service.js';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AccountingService } from '../accounting/accounting.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

describe('ExpensesService',()=>{
 const user:AuthenticatedUser={userId:'user-1',email:'owner@example.test',fullName:'Owner',companyId:'company-active',branchId:null,role:'owner',permissions:['expenses:read','expenses:write']};
 let db:{query:ReturnType<typeof vi.fn>;transaction:ReturnType<typeof vi.fn>};
 let memberships:{getMembership:ReturnType<typeof vi.fn>;getMembershipForCompany:ReturnType<typeof vi.fn>};
 let audit:{log:ReturnType<typeof vi.fn>;logInTransaction:ReturnType<typeof vi.fn>};
 let accounting:{ensureDefaults:ReturnType<typeof vi.fn>};
 let service:ExpensesService;
 beforeEach(()=>{
  db={query:vi.fn(),transaction:vi.fn()};
  const membership={companyId:'company-active',branchId:null,role:'owner'};
  memberships={getMembership:vi.fn(),getMembershipForCompany:vi.fn().mockResolvedValue(membership)};
  audit={log:vi.fn().mockResolvedValue(undefined),logInTransaction:vi.fn().mockResolvedValue(undefined)};
  accounting={ensureDefaults:vi.fn().mockResolvedValue(undefined)};
  service=new ExpensesService(db as unknown as DatabaseService,memberships as unknown as MembershipsService,audit as unknown as AuditService,accounting as unknown as AccountingService);
 });
 it('lists expenses within the active company only',async()=>{
  db.query.mockResolvedValue({rows:[],rowCount:0});
  await service.list(user);
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE e.company_id=$1'),['company-active']);
 });
 it('blocks branch-bound members from company-wide expenses before querying or writing',async()=>{
  const branchUser={...user,branchId:'branch-1'};
  memberships.getMembershipForCompany.mockResolvedValue({companyId:'company-active',branchId:'branch-1',role:'staff'});
  await expect(service.list(branchUser)).rejects.toThrow(ForbiddenException);
  await expect(service.create(branchUser,{description:'Office supplies',category:'Supplies',amount:25.5,paymentMethod:'cash'})).rejects.toThrow(ForbiddenException);
  expect(db.query).not.toHaveBeenCalled();
  expect(db.transaction).not.toHaveBeenCalled();
  expect(accounting.ensureDefaults).not.toHaveBeenCalled();
  expect(audit.logInTransaction).not.toHaveBeenCalled();
 });
 it('posts a balanced expense journal and records its source atomically',async()=>{
  const client={query:vi.fn().mockImplementation(async(sql:string,params:unknown[] = [])=>{
   if(sql.includes("system_code='operating_expense'"))return {rows:[{id:'expense-account',code:'5100',name:'Operating Expenses'}],rowCount:1};
   if(sql.includes('system_code=$2'))return {rows:[{id:'cash-account'}],rowCount:1};
   if(sql.includes('INSERT INTO expense_sequences'))return {rows:[{next_number:1}],rowCount:1};
   if(sql.includes('INSERT INTO expenses'))return {rows:[{id:'expense-1'}],rowCount:1};
   if(sql.includes('INSERT INTO journal_entry_sequences'))return {rows:[{next_number:2}],rowCount:1};
   if(sql.includes('INSERT INTO journal_entries'))return {rows:[{id:'journal-1'}],rowCount:1};
   return {rows:[],rowCount:1};
  })};
  db.transaction.mockImplementation(async(callback:(client:unknown)=>Promise<unknown>)=>callback(client));
  db.query.mockResolvedValue({rows:[{id:'expense-1',amount:'25.50',journal_entry_id:'journal-1'}],rowCount:1});
  const result=await service.create(user,{description:'Office supplies',category:'Supplies',amount:25.5,paymentMethod:'cash',expenseDate:'2026-10-15'});
  expect(result.journal_entry_id).toBe('journal-1');
  const lines=client.query.mock.calls.find((call:[string,unknown[]])=>call[0].includes('INSERT INTO journal_entry_lines'));
  expect(lines?.[0]).toContain('VALUES($1,$2,$3,$4,$5,0),($1,$2,$6,$7,0,$5)');
  expect(lines?.[1]).toEqual(['company-active','journal-1','expense-account','Office supplies',25.5,'cash-account','Paid by cash']);
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE expenses SET journal_entry_id=$1'),['journal-1','expense-1','company-active']);
  expect(audit.logInTransaction).toHaveBeenCalledWith(client,expect.objectContaining({action:'expenses.create',companyId:'company-active'}));
 });
 it('rejects a missing payment account before posting or auditing',async()=>{
  const client={query:vi.fn().mockImplementation(async(sql:string)=>{
   if(sql.includes("system_code='operating_expense'"))return {rows:[{id:'expense-account',code:'5100',name:'Operating Expenses'}],rowCount:1};
   if(sql.includes('system_code=$2'))return {rows:[],rowCount:0};
   return {rows:[],rowCount:1};
  })};
  db.transaction.mockImplementation(async(callback:(client:unknown)=>Promise<unknown>)=>callback(client));
  await expect(service.create(user,{description:'Office supplies',category:'Supplies',amount:25.5,paymentMethod:'mpesa'})).rejects.toThrow(BadRequestException);
  expect(client.query.mock.calls.some((call:[string,unknown[]])=>call[0].includes('INSERT INTO journal_entries'))).toBe(false);
  expect(audit.log).not.toHaveBeenCalled();
 });
});
