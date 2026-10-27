import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

@Injectable()
export class WorkforceService {
  constructor(private readonly db: DatabaseService, private readonly memberships: MembershipsService, private readonly audit: AuditService) {}
  private async membership(u: AuthenticatedUser) { return u.companyId ? this.memberships.getMembershipForCompany(u.userId, u.companyId) : this.memberships.getMembership(u.userId); }
  private assertCompanyWideImport(m: { branchId?: string | null }) {
    if (m.branchId) throw new ForbiddenException('Monthly attendance imports are company-wide until branch attribution is supported. A company-wide HR administrator must perform this action.');
  }
  private required(v: unknown, label: string) { if (typeof v !== 'string' || !v.trim()) throw new BadRequestException(label + ' is required.'); return v.trim(); }
  private date(v: unknown, label: string) { const s = this.required(v, label); const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!match) throw new BadRequestException(label + ' must be a real date in YYYY-MM-DD format.'); const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]); const parsed = new Date(Date.UTC(year, month - 1, day)); if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new BadRequestException(label + ' must be a real date in YYYY-MM-DD format.'); return s; }
  private rate(v: unknown) { const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new BadRequestException('payRate must be non-negative.'); return n; }

  async sites(u: AuthenticatedUser) { const m = await this.membership(u); return (await this.db.query('SELECT * FROM client_sites WHERE company_id=$1 ORDER BY client_name,site_name', [m.companyId])).rows; }
  async createSite(u: AuthenticatedUser, d: Record<string, unknown>) {
    const m = await this.membership(u);
    try {
      const row = (await this.db.query('INSERT INTO client_sites(company_id,site_code,site_name,client_name,address,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [m.companyId,this.required(d.siteCode,'siteCode'),this.required(d.siteName,'siteName'),this.required(d.clientName,'clientName'),typeof d.address === 'string' ? d.address.trim() || null : null,u.userId])).rows[0];
      await this.audit.log({userId:u.userId,companyId:m.companyId,branchId:m.branchId,action:'workforce.site.create',entityType:'client_site',entityId:String(row.id),oldValues:null,newValues:{siteCode:row.site_code,siteName:row.site_name},ipAddress:null}); return row;
    } catch (e) { if ((e as {code?:string}).code === '23505') throw new ConflictException('Site code already exists in this company.'); throw e; }
  }
  async assignments(u: AuthenticatedUser) {
    const m = await this.membership(u);
    return (await this.db.query('SELECT a.*,e.employee_number,e.first_name,e.last_name,s.site_name,s.client_name FROM employee_assignments a JOIN employees e ON e.id=a.employee_id AND e.company_id=a.company_id JOIN client_sites s ON s.id=a.site_id AND s.company_id=a.company_id WHERE a.company_id=$1 AND ($2::uuid IS NULL OR e.branch_id=$2::uuid) ORDER BY a.start_date DESC', [m.companyId,m.branchId ?? null])).rows;
  }
  async createAssignment(u: AuthenticatedUser, d: Record<string, unknown>) {
    const m=await this.membership(u), employeeId=this.required(d.employeeId,'employeeId'), siteId=this.required(d.siteId,'siteId'), start=this.date(d.startDate,'startDate'), basis=this.required(d.payBasis,'payBasis');
    if (!['monthly','daily','hourly','per_shift'].includes(basis)) throw new BadRequestException('payBasis must be monthly, daily, hourly or per_shift.');
    const rate=this.rate(d.payRate), end=d.endDate ? this.date(d.endDate,'endDate') : null;
    if (end && end < start) throw new BadRequestException('endDate precedes startDate.');
    const row=await this.db.transaction(async c=>{
      const employee=await c.query("SELECT id FROM employees WHERE id=$1 AND company_id=$2 AND employment_status NOT IN ('terminated','inactive') AND ($3::uuid IS NULL OR branch_id=$3::uuid) FOR UPDATE",[employeeId,m.companyId,m.branchId ?? null]);
      if (!employee.rows.length) throw new NotFoundException('Active employee not found in this company.');
      const site=await c.query('SELECT id FROM client_sites WHERE id=$1 AND company_id=$2 AND is_active=true',[siteId,m.companyId]);
      if (!site.rows.length) throw new NotFoundException('Active site not found in this company.');
      const overlap=await c.query("SELECT id FROM employee_assignments WHERE company_id=$1 AND employee_id=$2 AND status='active' AND start_date<=COALESCE($4::date,'9999-12-31') AND COALESCE(end_date,'9999-12-31') >= $3::date FOR UPDATE",[m.companyId,employeeId,start,end]);
      if (overlap.rows.length) throw new ConflictException('Employee already has an overlapping active assignment.');
      return (await c.query('INSERT INTO employee_assignments(company_id,employee_id,site_id,assignment_title,pay_basis,pay_rate,currency,start_date,end_date,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10,$11) RETURNING *',[m.companyId,employeeId,siteId,typeof d.assignmentTitle==='string'?d.assignmentTitle.trim()||null:null,basis,rate,typeof d.currency==='string'&&/^[A-Za-z]{3}$/.test(d.currency)?d.currency.toUpperCase():'KES',start,end,typeof d.notes==='string'?d.notes.trim()||null:null,u.userId])).rows[0];
    });
    await this.audit.log({userId:u.userId,companyId:m.companyId,branchId:m.branchId,action:'workforce.assignment.create',entityType:'employee_assignment',entityId:String(row.id),oldValues:null,newValues:{employeeId,siteId,payBasis:basis,payRate:rate,startDate:start},ipAddress:null}); return row;
  }
  async transfer(u: AuthenticatedUser, id: string, d: Record<string, unknown>) {
    const m=await this.membership(u), effective=this.date(d.effectiveDate,'effectiveDate'), siteId=this.required(d.siteId,'siteId'), basis=this.required(d.payBasis,'payBasis');
    if (!['monthly','daily','hourly','per_shift'].includes(basis)) throw new BadRequestException('Invalid payBasis.');
    const rate=this.rate(d.payRate);
    const row=await this.db.transaction(async c=>{
      const old=await c.query("SELECT a.* FROM employee_assignments a JOIN employees e ON e.id=a.employee_id AND e.company_id=a.company_id WHERE a.id=$1 AND a.company_id=$2 AND a.status='active' AND ($3::uuid IS NULL OR e.branch_id=$3::uuid) FOR UPDATE OF a",[id,m.companyId,m.branchId ?? null]);
      if (!old.rows.length) throw new NotFoundException('Active assignment not found.');
      const start=String(old.rows[0].start_date).slice(0,10); if (effective<start) throw new BadRequestException('Transfer date precedes assignment start.'); const scheduledEnd=old.rows[0].end_date ? String(old.rows[0].end_date).slice(0,10) : null; if (scheduledEnd && effective>scheduledEnd) throw new BadRequestException('Transfer date is after the assignment end date.');
      const site=await c.query('SELECT id FROM client_sites WHERE id=$1 AND company_id=$2 AND is_active=true',[siteId,m.companyId]);
      if (!site.rows.length) throw new NotFoundException('Active destination site not found.');
      const end=new Date(Date.parse(effective+'T00:00:00Z')-86400000).toISOString().slice(0,10);
      if (end < start) throw new BadRequestException('Transfer date cannot precede assignment start.');
      await c.query("UPDATE employee_assignments SET end_date=$2::date,status='ended',updated_at=NOW() WHERE id=$1",[id,end]);
      return (await c.query('INSERT INTO employee_assignments(company_id,employee_id,site_id,assignment_title,pay_basis,pay_rate,currency,start_date,end_date,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10,$11) RETURNING *',[m.companyId,old.rows[0].employee_id,siteId,typeof d.assignmentTitle==='string'?d.assignmentTitle.trim()||old.rows[0].assignment_title:null,basis,rate,typeof d.currency==='string'&&/^[A-Za-z]{3}$/.test(d.currency)?d.currency.toUpperCase():old.rows[0].currency,effective,old.rows[0].end_date,typeof d.notes==='string'?d.notes.trim()||null:old.rows[0].notes,u.userId])).rows[0];
    });
    await this.audit.log({userId:u.userId,companyId:m.companyId,branchId:m.branchId,action:'workforce.assignment.transfer',entityType:'employee_assignment',entityId:String(row.id),oldValues:{previousAssignmentId:id},newValues:{siteId,effectiveDate:effective,payBasis:basis,payRate:rate},ipAddress:null}); return row;
  }
  async attendance(u: AuthenticatedUser, from?: string, to?: string, employeeId?: string) {
    const m=await this.membership(u), params:(string|number|boolean|Date|null)[]=[m.companyId];
    const fromDate = from ? this.date(from, 'from') : undefined;
    const toDate = to ? this.date(to, 'to') : undefined;
    if (fromDate && toDate && fromDate > toDate) throw new BadRequestException('from must be on or before to.');
    let sql='SELECT a.*,e.employee_number,e.first_name,e.last_name,s.site_name,s.client_name FROM attendance_records a JOIN employees e ON e.id=a.employee_id AND e.company_id=a.company_id LEFT JOIN employee_assignments x ON x.id=a.assignment_id AND x.company_id=a.company_id LEFT JOIN client_sites s ON s.id=x.site_id AND s.company_id=x.company_id WHERE a.company_id=$1 AND ($2::uuid IS NULL OR e.branch_id=$2::uuid)';
    params.push(m.branchId ?? null);
    if(fromDate){params.push(fromDate);sql+=' AND a.punched_at >= $'+params.length+'::date';}
    if(toDate){params.push(toDate);sql+=' AND a.punched_at < ($'+params.length+'::date + INTERVAL \'1 day\')';}
    if(employeeId){params.push(employeeId);sql+=' AND a.employee_id=$'+params.length;}
    sql+=' ORDER BY a.punched_at DESC LIMIT 1000'; return (await this.db.query(sql,params)).rows;
  }

  private normalizedNationalId(value: unknown) {
    if (typeof value !== 'string') throw new BadRequestException('Every checklist row must include a national ID number.');
    const normalized = value.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (!/^\d{5,12}$/.test(normalized)) throw new BadRequestException('National ID numbers must contain 5 to 12 digits.');
    return normalized;
  }

  private monthPeriod(value: unknown) {
    if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new BadRequestException('period must be in YYYY-MM format.');
    const [year, month] = value.split('-').map(Number);
    return { period: value, start: `${value}-01`, end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) };
  }

  private monthlyRows(value: unknown) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 1000) throw new BadRequestException('rows must contain between 1 and 1000 checklist entries.');
    const seen = new Set<string>();
    return value.map((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException(`Row ${index + 1} is invalid.`);
      const row = raw as Record<string, unknown>;
      const nationalId = this.normalizedNationalId(row.nationalId);
      if (seen.has(nationalId)) throw new BadRequestException(`National ID is duplicated in the checklist (row ${index + 1}).`);
      seen.add(nationalId);
      const count = (field: string) => {
        const n = Number(row[field] ?? 0);
        if (!Number.isInteger(n) || n < 0 || n > 31) throw new BadRequestException(`Row ${index + 1}: ${field} must be a whole number between 0 and 31.`);
        return n;
      };
      const scheduledDays = count('scheduledDays'), presentDays = count('presentDays'), absentDays = count('absentDays');
      const leaveDays = count('leaveDays'), unresolvedDays = count('unresolvedDays'), restDays = count('restDays');
      if (presentDays + absentDays + leaveDays + unresolvedDays !== scheduledDays) throw new BadRequestException(`Row ${index + 1}: present, absent, leave and unresolved days must add up to scheduled days.`);
      const siteCode = typeof row.siteCode === 'string' && row.siteCode.trim() ? row.siteCode.trim() : null;
      const notes = typeof row.notes === 'string' ? row.notes.trim().slice(0, 2000) || null : null;
      return { nationalId, scheduledDays, presentDays, absentDays, leaveDays, unresolvedDays, restDays, siteCode, notes, rowNumber: index + 1 };
    });
  }

  async previewMonthlyAttendance(u: AuthenticatedUser, input: Record<string, unknown>) {
    const m = await this.membership(u); this.assertCompanyWideImport(m);
    const period = this.monthPeriod(input.period), rows = this.monthlyRows(input.rows);
    const sourceType = typeof input.sourceType === 'string' ? input.sourceType : 'csv';
    if (!['csv', 'spreadsheet', 'scan', 'manual'].includes(sourceType)) throw new BadRequestException('sourceType must be csv, spreadsheet, scan or manual.');
    const preview = [];
    for (const row of rows) {
      const match = await this.db.query(
        `SELECT id, first_name, last_name, employee_number FROM employees
         WHERE company_id=$1 AND regexp_replace(upper(national_id), '[^A-Z0-9]', '', 'g')=$2 LIMIT 2`,
        [m.companyId, row.nationalId],
      );
      let issue: string | null = null;
      let employee: Record<string, unknown> | null = null;
      if (match.rows.length === 0) issue = 'No employee matches this ID number in the active company.';
      else if (match.rows.length > 1) issue = 'This ID number matches more than one employee; HR must resolve the duplicate employee records.';
      else {
        employee = match.rows[0];
        if (row.siteCode) {
          const site = await this.db.query('SELECT id FROM client_sites WHERE company_id=$1 AND upper(site_code)=upper($2)', [m.companyId, row.siteCode]);
          if (!site.rows.length) issue = 'Site code was not found in this company.';
          else {
            const assignment = await this.db.query(
              `SELECT id FROM employee_assignments WHERE company_id=$1 AND employee_id=$2 AND site_id=$3
               AND start_date <= $5::date AND COALESCE(end_date, '9999-12-31'::date) >= $4::date LIMIT 1`,
              [m.companyId, String(employee.id), String(site.rows[0].id), period.start, period.end],
            );
            if (!assignment.rows.length) issue = 'Employee has no assignment to this site overlapping the selected month.';
          }
        }
      }
      preview.push({
        rowNumber: row.rowNumber, employeeId: employee?.id ?? null,
        employeeName: employee ? `${employee.first_name} ${employee.last_name}` : null,
        employeeNumber: employee?.employee_number ?? null,
        nationalIdMasked: `••••${row.nationalId.slice(-4)}`, siteCode: row.siteCode,
        scheduledDays: row.scheduledDays, presentDays: row.presentDays, absentDays: row.absentDays,
        leaveDays: row.leaveDays, restDays: row.restDays, unresolvedDays: row.unresolvedDays,
        notes: row.notes, issue,
      });
    }
    return {
      period: period.period, sourceType, totalRows: preview.length,
      matchedRows: preview.filter(row => row.employeeId && !row.issue).length,
      issueRows: preview.filter(row => row.issue).length,
      readyToImport: preview.every(row => Boolean(row.employeeId) && !row.issue), rows: preview,
    };
  }

  async createMonthlyAttendanceImport(u: AuthenticatedUser, input: Record<string, unknown>) {
    const m = await this.membership(u), period = this.monthPeriod(input.period);
    const sourceType = typeof input.sourceType === 'string' ? input.sourceType : 'csv';
    const sourceFilename = typeof input.sourceFilename === 'string' ? input.sourceFilename.trim().slice(0, 255) || null : null;
    const preview = await this.previewMonthlyAttendance(u, input);
    if (!preview.readyToImport) throw new BadRequestException('Resolve all unmatched employees and site/assignment issues before importing.');
    const rows = this.monthlyRows(input.rows);
    const result = await this.db.transaction(async client => {
      const batch = (await client.query(
        `INSERT INTO monthly_attendance_imports (company_id, period_start, period_end, source_type, source_filename, total_rows, imported_by)
         VALUES ($1,$2::date,$3::date,$4,$5,$6,$7) RETURNING *`,
        [m.companyId, period.start, period.end, sourceType, sourceFilename, rows.length, u.userId],
      )).rows[0];
      for (const row of rows) {
        const employee = await client.query(
          `SELECT id, first_name || ' ' || last_name AS full_name FROM employees
           WHERE company_id=$1 AND regexp_replace(upper(national_id), '[^A-Z0-9]', '', 'g')=$2 FOR SHARE`,
          [m.companyId, row.nationalId],
        );
        if (employee.rows.length !== 1) throw new ConflictException('An employee ID match changed during import. Preview the checklist again.');
        let siteId: string | null = null;
        if (row.siteCode) {
          const site = await client.query('SELECT id FROM client_sites WHERE company_id=$1 AND upper(site_code)=upper($2)', [m.companyId, row.siteCode]);
          if (!site.rows.length) throw new ConflictException('A site changed during import. Preview the checklist again.');
          siteId = String(site.rows[0].id);
        }
        await client.query(
          `INSERT INTO monthly_attendance_import_items
           (company_id, import_id, employee_id, national_id_last4, employee_name_snapshot, site_id,
            scheduled_days, present_days, absent_days, leave_days, rest_days, unresolved_days, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [m.companyId, String(batch.id), String(employee.rows[0].id), row.nationalId.slice(-4),
            String(employee.rows[0].full_name), siteId, row.scheduledDays, row.presentDays, row.absentDays,
            row.leaveDays, row.restDays, row.unresolvedDays, row.notes],
        );
      }
      return (await client.query('SELECT * FROM monthly_attendance_imports WHERE id=$1 AND company_id=$2', [String(batch.id), m.companyId])).rows[0];
    });
    await this.audit.log({
      userId: u.userId, companyId: m.companyId, branchId: m.branchId,
      action: 'workforce.attendance.monthly_import.create', entityType: 'monthly_attendance_import',
      entityId: String(result.id), oldValues: null,
      newValues: { period: period.period, sourceType, rowCount: rows.length, status: result.status }, ipAddress: null,
    });
    return result;
  }

  async monthlyAttendanceImports(u: AuthenticatedUser, periodValue?: string) {
    const m = await this.membership(u); this.assertCompanyWideImport(m);
    const params: (string | number | boolean | Date | null)[] = [m.companyId];
    let sql = `SELECT i.*, COUNT(d.id)::int AS item_count,
      COALESCE(SUM(d.present_days),0)::int AS present_days_total,
      COALESCE(SUM(d.absent_days),0)::int AS absent_days_total,
      COALESCE(SUM(d.leave_days),0)::int AS leave_days_total,
      COALESCE(SUM(d.unresolved_days),0)::int AS unresolved_days_total
      FROM monthly_attendance_imports i LEFT JOIN monthly_attendance_import_items d
      ON d.import_id=i.id AND d.company_id=i.company_id WHERE i.company_id=$1`;
    if (periodValue) {
      const period = this.monthPeriod(periodValue);
      params.push(period.start, period.end);
      sql += ' AND i.period_start=$2::date AND i.period_end=$3::date';
    }
    sql += ' GROUP BY i.id ORDER BY i.created_at DESC LIMIT 100';
    return (await this.db.query(sql, params)).rows;
  }

  async approveMonthlyAttendanceImport(u: AuthenticatedUser, id: string) {
    const m = await this.membership(u); this.assertCompanyWideImport(m);
    const result = await this.db.query(
      `UPDATE monthly_attendance_imports SET status='approved', approved_by=$3, approved_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND company_id=$2 AND status='draft' RETURNING *`,
      [id, m.companyId, u.userId],
    );
    if (!result.rows.length) {
      const exists = await this.db.query('SELECT status FROM monthly_attendance_imports WHERE id=$1 AND company_id=$2', [id, m.companyId]);
      if (!exists.rows.length) throw new NotFoundException('Monthly attendance import not found in this company.');
      throw new ConflictException('Only draft monthly attendance imports can be approved.');
    }
    await this.audit.log({
      userId: u.userId, companyId: m.companyId, branchId: m.branchId,
      action: 'workforce.attendance.monthly_import.approve', entityType: 'monthly_attendance_import',
      entityId: id, oldValues: { status: 'draft' }, newValues: { status: 'approved' }, ipAddress: null,
    });
    return result.rows[0];
  }

  async punch(u: AuthenticatedUser, d: Record<string, unknown>) {
    const m=await this.membership(u), employeeId=this.required(d.employeeId,'employeeId'), type=this.required(d.punchType,'punchType');
    if(!['in','out'].includes(type))throw new BadRequestException('punchType must be in or out.');
    const at=d.punchedAt==null?new Date():new Date(String(d.punchedAt));
    if(Number.isNaN(at.getTime())||at.getTime()>Date.now()+300000)throw new BadRequestException('Invalid punch timestamp or timestamp too far in the future.');
    const assignmentId=typeof d.assignmentId==='string'&&d.assignmentId.trim()?d.assignmentId.trim():null, ref=typeof d.externalReference==='string'?d.externalReference.trim()||null:null;
    const source=typeof d.source==='string'&&['web','mobile','qr','supervisor','import'].includes(d.source)?d.source:'web';
    try {
      const row=await this.db.transaction(async c=>{
        const employee=await c.query("SELECT id FROM employees WHERE id=$1 AND company_id=$2 AND employment_status NOT IN ('terminated','inactive') AND ($3::uuid IS NULL OR branch_id=$3::uuid) FOR UPDATE",[employeeId,m.companyId,m.branchId ?? null]);
        if(!employee.rows.length)throw new NotFoundException('Active employee not found in this company.');
        if(assignmentId){const a=await c.query("SELECT id FROM employee_assignments WHERE id=$1 AND company_id=$2 AND employee_id=$3 AND status='active' AND start_date<=$4::date AND (end_date IS NULL OR end_date >= $4::date)",[assignmentId,m.companyId,employeeId,at.toISOString().slice(0,10)]);if(!a.rows.length)throw new BadRequestException('Assignment is not active for this employee at punch time.');}
        const last=await c.query('SELECT punch_type,punched_at FROM attendance_records WHERE company_id=$1 AND employee_id=$2 ORDER BY punched_at DESC,id DESC LIMIT 1',[m.companyId,employeeId]);
        if (!last.rows.length && type === 'out') throw new BadRequestException('Employee must clock in before clocking out.');
        if(last.rows.length) {
          const lastAt = new Date(last.rows[0].punched_at as string | Date).getTime();
          if (at.getTime() <= lastAt) throw new BadRequestException('Punch timestamp must be later than the employee’s latest attendance event.');
          if(last.rows[0].punch_type===type) throw new ConflictException(type==='in'?'Employee is already clocked in.':'Employee is already clocked out.');
        }
        return (await c.query('INSERT INTO attendance_records(company_id,employee_id,assignment_id,punch_type,punched_at,source,note,external_reference,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[m.companyId,employeeId,assignmentId,type,at,source,typeof d.note==='string'?d.note.trim()||null:null,ref,u.userId])).rows[0];
      });
      await this.audit.log({userId:u.userId,companyId:m.companyId,branchId:m.branchId,action:'workforce.attendance.punch',entityType:'attendance_record',entityId:String(row.id),oldValues:null,newValues:{employeeId,punchType:type,punchedAt:at.toISOString(),assignmentId},ipAddress:null});return row;
    } catch(e) { if((e as {code?:string}).code==='23505')throw new ConflictException('Attendance event already recorded.');throw e; }
  }
}
