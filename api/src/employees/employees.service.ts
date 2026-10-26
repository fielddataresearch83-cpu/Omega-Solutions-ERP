import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import type { CreateEmployeeDto, CreateLeaveRequestDto, ReviewLeaveRequestDto } from './dto/employee.dto.js';

@Injectable()
export class EmployeesService {
  constructor(private readonly db: DatabaseService, private readonly memberships: MembershipsService, private readonly audit: AuditService) {}
  private async membershipFor(user: AuthenticatedUser) {
    return user.companyId ? this.memberships.getMembershipForCompany(user.userId,user.companyId) : this.memberships.getMembership(user.userId);
  }
  async list(user: AuthenticatedUser) {
    const membership=await this.membershipFor(user);
    return (await this.db.query(`SELECT e.id,e.company_id,e.branch_id,b.name AS branch_name,e.employee_number,e.first_name,e.last_name,e.work_email,e.phone,e.job_title,e.department,e.employment_status,e.hire_date,e.created_at,e.updated_at,(e.kra_pin IS NOT NULL) AS has_kra_pin,(e.nssf_number IS NOT NULL) AS has_nssf_number,(e.sha_number IS NOT NULL) AS has_sha_number,(e.nhif_number IS NOT NULL) AS has_nhif_number
      FROM employees e LEFT JOIN branches b ON b.id=e.branch_id AND b.company_id=e.company_id
      WHERE e.company_id=$1 AND ($2::uuid IS NULL OR e.branch_id=$2) ORDER BY e.last_name,e.first_name`,[membership.companyId,membership.branchId])).rows;
  }
  async create(user: AuthenticatedUser,dto: CreateEmployeeDto) {
    const membership=await this.membershipFor(user);
    if(membership.branchId && dto.branchId && dto.branchId!==membership.branchId) {
      throw new BadRequestException('You can only create employees assigned to your own branch.');
    }
    const employeeBranchId=membership.branchId??dto.branchId??null;
    if(employeeBranchId) {
      const branch=await this.db.query('SELECT id FROM branches WHERE id=$1 AND company_id=$2 AND is_active=true',[employeeBranchId,membership.companyId]);
      if(!branch.rows.length) throw new BadRequestException('The branch must be active and belong to this company.');
    }
    const nationalId=dto.nationalId?.trim().replace(/[^0-9]/g,'')||null;
    if(nationalId && !/^\d{5,12}$/.test(nationalId)) throw new BadRequestException('National ID must contain 5 to 12 digits.');
    const kraPin=dto.kraPin?.trim().toUpperCase().replace(/\s+/g,'')||null;
    if(kraPin && !/^[A-Z]\d{9}[A-Z]$/.test(kraPin)) throw new BadRequestException('KRA PIN must be in the format A123456789Z.');
    const normalizeMembershipNumber=(value:string|undefined,label:string)=>{const normalized=value?.trim().toUpperCase().replace(/[\s-]/g,'')||null;if(normalized&&!/^[A-Z0-9/]{4,30}$/.test(normalized))throw new BadRequestException(`${label} must contain 4 to 30 letters or digits.`);return normalized;};
    const nssfNumber=normalizeMembershipNumber(dto.nssfNumber,'NSSF number');
    const shaNumber=normalizeMembershipNumber(dto.shaNumber,'SHA/SHIF number');
    const nhifNumber=normalizeMembershipNumber(dto.nhifNumber,'Legacy NHIF number');
    try {
      const result=await this.db.query(`INSERT INTO employees(company_id,branch_id,employee_number,national_id,kra_pin,nssf_number,sha_number,nhif_number,first_name,last_name,work_email,phone,job_title,department,hire_date,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::date,$16)
        RETURNING id,company_id,branch_id,employee_number,first_name,last_name,work_email,phone,job_title,department,employment_status,hire_date,created_at,updated_at,
          (kra_pin IS NOT NULL) AS has_kra_pin,(nssf_number IS NOT NULL) AS has_nssf_number,(sha_number IS NOT NULL) AS has_sha_number,(nhif_number IS NOT NULL) AS has_nhif_number`,
      [membership.companyId,employeeBranchId,dto.employeeNumber.trim(),nationalId,kraPin,nssfNumber,shaNumber,nhifNumber,dto.firstName.trim(),dto.lastName.trim(),dto.workEmail?.trim().toLowerCase()??null,dto.phone?.trim()??null,dto.jobTitle?.trim()??null,dto.department?.trim()??null,dto.hireDate??null,user.userId]);
      const employee=result.rows[0];
      await this.audit.log({userId:user.userId,companyId:membership.companyId,branchId:membership.branchId,action:'employees.create',entityType:'employee',entityId:String(employee.id),oldValues:null,newValues:{employeeNumber:employee.employee_number,nationalIdLast4:nationalId?.slice(-4)??null,kraPinLast4:kraPin?.slice(-4)??null,nssfNumberLast4:nssfNumber?.slice(-4)??null,shaNumberLast4:shaNumber?.slice(-4)??null,nhifNumberLast4:nhifNumber?.slice(-4)??null},ipAddress:null});
      return employee;
    } catch(error) {
      if((error as {code?:string}).code==='23505') throw new ConflictException('An employee with this number or national ID already exists in this company.');
      throw error;
    }
  }

  async updateNationalId(user: AuthenticatedUser, id: string, value: unknown) {
    const membership = await this.membershipFor(user);
    if (typeof value !== 'string') throw new BadRequestException('National ID is required.');
    const nationalId = value.trim().replace(/[^0-9]/g, '');
    if (!/^\d{5,12}$/.test(nationalId)) throw new BadRequestException('National ID must contain 5 to 12 digits.');
    try {
      const result = await this.db.query(
        `UPDATE employees SET national_id=$3, updated_at=NOW()
         WHERE id=$1 AND company_id=$2
         RETURNING id, employee_number, first_name, last_name, updated_at`,
        [id, membership.companyId, nationalId],
      );
      if (!result.rows.length) throw new NotFoundException('Employee not found in this company.');
      await this.audit.log({
        userId: user.userId, companyId: membership.companyId, branchId: membership.branchId,
        action: 'employees.national_id.update', entityType: 'employee', entityId: id,
        oldValues: null, newValues: { nationalIdLast4: nationalId.slice(-4) }, ipAddress: null,
      });
      return { ...result.rows[0], nationalIdMasked: `••••${nationalId.slice(-4)}` };
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('This national ID is already assigned to another employee in this company.');
      throw error;
    }
  }

  async listLeaveRequests(user: AuthenticatedUser) {
    const membership=await this.membershipFor(user);
    const {companyId}=membership;
    return (await this.db.query(`SELECT l.id,l.company_id,l.employee_id,e.employee_number,e.first_name,e.last_name,l.leave_type,l.start_date,l.end_date,l.reason,l.status,l.reviewed_by,l.reviewed_at,l.review_note,l.created_at,l.updated_at
      FROM employee_leave_requests l JOIN employees e ON e.id=l.employee_id AND e.company_id=l.company_id
      WHERE l.company_id=$1 AND ($2::uuid IS NULL OR e.branch_id=$2) ORDER BY l.created_at DESC`,[companyId,membership.branchId])).rows;
  }
  async createLeaveRequest(user: AuthenticatedUser,dto: CreateLeaveRequestDto) {
    const membership=await this.membershipFor(user);
    if(dto.endDate<dto.startDate) throw new BadRequestException('Leave end date must be on or after its start date.');
    const result=await this.db.transaction(async client=>{
      const employee=await client.query('SELECT id FROM employees WHERE id=$1 AND company_id=$2 AND ($3::uuid IS NULL OR branch_id=$3) FOR UPDATE',[dto.employeeId,membership.companyId,membership.branchId]);
      if(!employee.rows.length) throw new NotFoundException('Employee not found in this company.');
      const overlap=await client.query(`SELECT id FROM employee_leave_requests WHERE company_id=$1 AND employee_id=$2 AND status IN ('pending','approved')
        AND start_date <= $4::date AND end_date >= $3::date LIMIT 1`,[membership.companyId,dto.employeeId,dto.startDate,dto.endDate]);
      if(overlap.rows.length) throw new ConflictException('This leave request overlaps an existing pending or approved request.');
      return (await client.query(`INSERT INTO employee_leave_requests(company_id,employee_id,leave_type,start_date,end_date,reason,created_by)
        VALUES($1,$2,$3,$4::date,$5::date,$6,$7) RETURNING *`,[membership.companyId,dto.employeeId,dto.leaveType,dto.startDate,dto.endDate,dto.reason?.trim()||null,user.userId])).rows[0];
    });
    await this.audit.log({userId:user.userId,companyId:membership.companyId,branchId:membership.branchId,action:'employees.leave.create',entityType:'employee_leave_request',entityId:String(result.id),oldValues:null,newValues:{employeeId:dto.employeeId,leaveType:dto.leaveType,status:'pending'},ipAddress:null});
    return result;
  }
  async reviewLeaveRequest(user: AuthenticatedUser,id:string,dto:ReviewLeaveRequestDto) {
    const membership=await this.membershipFor(user);
    const result=await this.db.query(`UPDATE employee_leave_requests SET status=$3,reviewed_by=$4,reviewed_at=NOW(),review_note=$5,updated_at=NOW()
      WHERE id=$1 AND company_id=$2 AND status='pending' AND EXISTS (SELECT 1 FROM employees e WHERE e.id=employee_leave_requests.employee_id AND e.company_id=$2 AND ($6::uuid IS NULL OR e.branch_id=$6)) RETURNING *`,[id,membership.companyId,dto.status,user.userId,dto.reviewNote?.trim()||null,membership.branchId]);
    if(!result.rows.length) {
      const exists=await this.db.query('SELECT l.id FROM employee_leave_requests l JOIN employees e ON e.id=l.employee_id AND e.company_id=l.company_id WHERE l.id=$1 AND l.company_id=$2 AND ($3::uuid IS NULL OR e.branch_id=$3)',[id,membership.companyId,membership.branchId]);
      if(!exists.rows.length) throw new NotFoundException('Leave request not found in this company.');
      throw new ConflictException('Only pending leave requests can be reviewed.');
    }
    await this.audit.log({userId:user.userId,companyId:membership.companyId,branchId:membership.branchId,action:'employees.leave.review',entityType:'employee_leave_request',entityId:id,oldValues:{status:'pending'},newValues:{status:dto.status},ipAddress:null});
    return result.rows[0];
  }
}
