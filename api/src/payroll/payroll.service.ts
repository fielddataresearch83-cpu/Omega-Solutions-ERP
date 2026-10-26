import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import { calculateKenyaMonthlyPayroll } from './kenya-payroll-calculator.js';
import type { NssfMethod, PayrollStatutoryOptions } from './kenya-payroll-calculator.js';

interface PayEmployee {
 [key:string]:unknown;
 id:string;employee_number:string;first_name:string;last_name:string;
 monthly_basic_salary:string|number;monthly_taxable_allowances:string|number;monthly_taxable_benefits:string|number;
 employee_pension_contribution:string|number;post_retirement_medical_contribution:string|number;
 qualifying_mortgage_interest:string|number;eligible_insurance_premiums:string|number;resident_for_tax_purposes:boolean;
}
const amount=(value:string|number)=>Math.round(Number(value)*100)/100;
const dateOnly=(value:unknown)=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const payFields=['monthlyBasicSalary','monthlyTaxableAllowances','monthlyTaxableBenefits','employeePensionContribution','postRetirementMedicalContribution','qualifyingMortgageInterest','eligibleInsurancePremiums'] as const;

@Injectable()
export class PayrollService {
 constructor(private readonly db:DatabaseService,private readonly memberships:MembershipsService){}
 private membershipFor(user:AuthenticatedUser){return user.companyId?this.memberships.getMembershipForCompany(user.userId,user.companyId):this.memberships.getMembership(user.userId);}
 private assertCompanyWidePayroll(membership:{branchId?:string|null}){if(membership.branchId)throw new ForbiddenException('Payroll runs and company statutory settings are company-wide. A company-wide payroll administrator must perform this action.');}
 private assertRunTotalsReconcile(run:Record<string,unknown>,items:Array<Record<string,unknown>>){
  const sum=(field:string)=>items.reduce((total,item)=>total+Number(item[field]??0),0);
  const same=(actual:unknown,expected:number)=>Number.isFinite(Number(actual))&&Number.isFinite(expected)&&Math.abs(Number(actual)-expected)<=0.01;
  const itemAmountsReconcile=items.every(item=>{
   const amountFields=['gross_cash_pay','taxable_benefits','nssf_employee','nssf_employer','shif_employee','housing_levy_employee','housing_levy_employer','paye','pension_employee','prmf_employee','employee_deductions','net_pay','employer_statutory_cost'];
   if(!amountFields.every(field=>Number.isFinite(Number(item[field]))&&Number(item[field])>=0))return false;
   const expectedDeductions=Number(item.paye)+Number(item.nssf_employee)+Number(item.shif_employee)+Number(item.housing_levy_employee)+Number(item.pension_employee)+Number(item.prmf_employee);
   return same(item.employee_deductions,expectedDeductions)&&
    same(item.net_pay,Number(item.gross_cash_pay)-Number(item.employee_deductions))&&
    same(item.employer_statutory_cost,Number(item.nssf_employer)+Number(item.housing_levy_employer));
  });
  const gross=sum('gross_cash_pay')+sum('taxable_benefits');
  const employerStatutoryFromItems=sum('nssf_employer')+sum('housing_levy_employer');
  const employerStatutoryStored=sum('employer_statutory_cost');
  const reconciles=Number(run.employee_count)===items.length&&itemAmountsReconcile&&
   same(run.gross_total,gross)&&
   same(run.employee_deductions_total,sum('employee_deductions'))&&
   same(run.net_pay_total,sum('net_pay'))&&
   same(employerStatutoryStored,employerStatutoryFromItems)&&
   same(run.employer_cost_total,gross+employerStatutoryFromItems);
  if(!reconciles)throw new ConflictException('Payroll run totals do not reconcile with its saved employee items. Approval/posting is blocked; review and correct the run through an audited correction process first. No journal was created.');
 }
 async getCompanyStatutorySettings(user:AuthenticatedUser,effectiveFromValue?:string){
  const membership=await this.membershipFor(user);this.assertCompanyWidePayroll(membership);
  const {companyId}=membership;
  const effectiveFrom=effectiveFromValue??new Date().toISOString().slice(0,10);
  if(!validDate(effectiveFrom))throw new BadRequestException('effectiveFrom must be a valid YYYY-MM-DD date.');
  const result=await this.db.query(`SELECT id,company_id,effective_from,nssf_method,nssf_employee_flat,nssf_employer_flat,nssf_employee_rate,nssf_employer_rate,nssf_pensionable_pay_cap,housing_levy_enabled,housing_levy_employee_rate,housing_levy_employer_rate,created_at
   FROM company_payroll_statutory_settings WHERE company_id=$1 AND effective_from<=$2::date ORDER BY effective_from DESC LIMIT 1`,[companyId,effectiveFrom]);
  return result.rows[0]??{company_id:companyId,effective_from:effectiveFrom,nssf_method:'YEAR4',nssf_employee_flat:'200.00',nssf_employer_flat:'200.00',nssf_employee_rate:'0.060000',nssf_employer_rate:'0.060000',nssf_pensionable_pay_cap:'108000.00',housing_levy_enabled:null,housing_levy_employee_rate:'0.015000',housing_levy_employer_rate:'0.015000',configurationSource:'default'};
 }
 async setCompanyStatutorySettings(user:AuthenticatedUser,dto:Record<string,unknown>){
  const membership=await this.membershipFor(user);this.assertCompanyWidePayroll(membership);
  const {companyId}=membership;
  const effectiveFrom=dto.effectiveFrom??new Date().toISOString().slice(0,10);
  if(typeof effectiveFrom!=='string'||!validDate(effectiveFrom))throw new BadRequestException('effectiveFrom must be a valid YYYY-MM-DD date.');
  const nssfMethod=String(dto.nssfMethod??'YEAR4') as NssfMethod;
  if(!['YEAR4','LEGACY_FLAT_200','CUSTOM'].includes(String(nssfMethod)))throw new BadRequestException('nssfMethod must be YEAR4, LEGACY_FLAT_200, or CUSTOM.');
  const numeric:Record<string,number>={};
  const defaults:Record<string,number>={nssfEmployeeFlat:200,nssfEmployerFlat:200,nssfEmployeeRate:.06,nssfEmployerRate:.06,nssfPensionablePayCap:108000,housingLevyEmployeeRate:.015,housingLevyEmployerRate:.015};
  for(const [key,fallback] of Object.entries(defaults)){
   const value=dto[key]===undefined?fallback:dto[key];
   if(typeof value!=='number'||!Number.isFinite(value)||value<0||((key.endsWith('Rate'))&&value>1))throw new BadRequestException(`${key} must be a valid non-negative number${key.endsWith('Rate')?' no greater than 1':''}.`);
   numeric[key]=value;
  }
  const rawHousingLevyEnabled: unknown = dto.housingLevyEnabled;
  if(typeof rawHousingLevyEnabled!=='boolean')throw new BadRequestException('Choose whether this company remits the housing levy (enabled or disabled) before saving statutory settings.');
  const housingLevyEnabled: boolean = rawHousingLevyEnabled;
  const result=await this.db.query(`INSERT INTO company_payroll_statutory_settings(company_id,effective_from,nssf_method,nssf_employee_flat,nssf_employer_flat,nssf_employee_rate,nssf_employer_rate,nssf_pensionable_pay_cap,housing_levy_enabled,housing_levy_employee_rate,housing_levy_employer_rate,created_by)
   VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
   ON CONFLICT(company_id,effective_from) DO UPDATE SET nssf_method=EXCLUDED.nssf_method,nssf_employee_flat=EXCLUDED.nssf_employee_flat,nssf_employer_flat=EXCLUDED.nssf_employer_flat,nssf_employee_rate=EXCLUDED.nssf_employee_rate,nssf_employer_rate=EXCLUDED.nssf_employer_rate,nssf_pensionable_pay_cap=EXCLUDED.nssf_pensionable_pay_cap,housing_levy_enabled=EXCLUDED.housing_levy_enabled,housing_levy_employee_rate=EXCLUDED.housing_levy_employee_rate,housing_levy_employer_rate=EXCLUDED.housing_levy_employer_rate
   RETURNING id,company_id,effective_from,nssf_method,nssf_employee_flat,nssf_employer_flat,nssf_employee_rate,nssf_employer_rate,nssf_pensionable_pay_cap,housing_levy_enabled,housing_levy_employee_rate,housing_levy_employer_rate,created_at`,
   [companyId,effectiveFrom,String(nssfMethod),numeric.nssfEmployeeFlat,numeric.nssfEmployerFlat,numeric.nssfEmployeeRate,numeric.nssfEmployerRate,numeric.nssfPensionablePayCap,housingLevyEnabled===true,numeric.housingLevyEmployeeRate,numeric.housingLevyEmployerRate,user.userId]);
  return result.rows[0];
 }
 async getEmployeePaySettings(user:AuthenticatedUser,employeeId:string){
  const membership=await this.membershipFor(user);
  const {companyId}=membership;
  const result=await this.db.query(`SELECT s.id,s.company_id,s.employee_id,s.monthly_basic_salary,s.monthly_taxable_allowances,s.monthly_taxable_benefits,s.employee_pension_contribution,s.post_retirement_medical_contribution,s.qualifying_mortgage_interest,s.eligible_insurance_premiums,s.resident_for_tax_purposes,s.effective_from,s.created_at,s.updated_at
   FROM employee_pay_settings s JOIN employees e ON e.id=s.employee_id AND e.company_id=s.company_id
   WHERE s.employee_id=$1 AND s.company_id=$2 AND ($3::uuid IS NULL OR e.branch_id=$3) AND s.effective_from<=CURRENT_DATE ORDER BY s.effective_from DESC LIMIT 1`,[employeeId,companyId,membership.branchId]);
  if(!result.rows.length)throw new NotFoundException('Pay settings not found for this employee in this company.');
  return result.rows[0];
 }
 async setEmployeePaySettings(user:AuthenticatedUser,employeeId:string,dto:Record<string,unknown>){
  const membership=await this.membershipFor(user);
  const {companyId}=membership;
  const employee=await this.db.query('SELECT id FROM employees WHERE id=$1 AND company_id=$2 AND ($3::uuid IS NULL OR branch_id=$3)',[employeeId,companyId,membership.branchId]);
  if(!employee.rows.length)throw new NotFoundException('Employee not found in this company.');
  const keys=['monthlyBasicSalary','monthlyTaxableAllowances','monthlyTaxableBenefits','employeePensionContribution','postRetirementMedicalContribution','qualifyingMortgageInterest','eligibleInsurancePremiums'];
  for(const key of keys){
   const value=dto[key]===undefined?(key==='monthlyBasicSalary'?undefined:0):dto[key];
   if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new BadRequestException(`${key} must be a finite non-negative number.`);
  }
  if(dto.residentForTaxPurposes!==undefined&&typeof dto.residentForTaxPurposes!=='boolean')throw new BadRequestException('residentForTaxPurposes must be a boolean.');
  const effectiveFrom=dto.effectiveFrom===undefined?new Date().toISOString().slice(0,10):dto.effectiveFrom;
  if(typeof effectiveFrom!=='string'||!validDate(effectiveFrom))throw new BadRequestException('effectiveFrom must be a valid YYYY-MM-DD date.');
  const values=keys.map(key=>dto[key]===undefined?0:dto[key] as number);
  const result=await this.db.query(`INSERT INTO employee_pay_settings(company_id,employee_id,monthly_basic_salary,monthly_taxable_allowances,monthly_taxable_benefits,employee_pension_contribution,post_retirement_medical_contribution,qualifying_mortgage_interest,eligible_insurance_premiums,resident_for_tax_purposes,effective_from,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12)
   ON CONFLICT(company_id,employee_id,effective_from) DO UPDATE SET monthly_basic_salary=EXCLUDED.monthly_basic_salary,monthly_taxable_allowances=EXCLUDED.monthly_taxable_allowances,monthly_taxable_benefits=EXCLUDED.monthly_taxable_benefits,employee_pension_contribution=EXCLUDED.employee_pension_contribution,post_retirement_medical_contribution=EXCLUDED.post_retirement_medical_contribution,qualifying_mortgage_interest=EXCLUDED.qualifying_mortgage_interest,eligible_insurance_premiums=EXCLUDED.eligible_insurance_premiums,resident_for_tax_purposes=EXCLUDED.resident_for_tax_purposes,effective_from=EXCLUDED.effective_from,updated_at=NOW()
   RETURNING id,company_id,employee_id,monthly_basic_salary,monthly_taxable_allowances,monthly_taxable_benefits,employee_pension_contribution,post_retirement_medical_contribution,qualifying_mortgage_interest,eligible_insurance_premiums,resident_for_tax_purposes,effective_from,created_at,updated_at`,
   [companyId,employeeId,...values,dto.residentForTaxPurposes===false?false:true,effectiveFrom,user.userId]);
  return result.rows[0];
 }
 async listRuns(user:AuthenticatedUser){
  const membership=await this.membershipFor(user);this.assertCompanyWidePayroll(membership);
  const {companyId}=membership;
  return (await this.db.query(`SELECT id,company_id,period_start,period_end,status,employee_count,gross_total,employee_deductions_total,net_pay_total,employer_cost_total,journal_entry_id,created_at,approved_at,posted_at
   FROM payroll_runs WHERE company_id=$1 ORDER BY period_start DESC,created_at DESC`,[companyId])).rows;
 }
 async getRun(user:AuthenticatedUser,id:string){
  const membership=await this.membershipFor(user);this.assertCompanyWidePayroll(membership);
  const {companyId}=membership;
  const run=await this.db.query(`SELECT id,company_id,period_start,period_end,status,employee_count,gross_total,employee_deductions_total,net_pay_total,employer_cost_total,journal_entry_id,created_at,approved_at,posted_at
   FROM payroll_runs WHERE id=$1 AND company_id=$2`,[id,companyId]);
  if(!run.rows.length)throw new NotFoundException('Payroll run not found in this company.');
  const items=await this.db.query(`SELECT id,employee_id,employee_number,employee_name,gross_cash_pay,taxable_benefits,nssf_employee,nssf_employer,shif_employee,housing_levy_employee,housing_levy_employer,paye,pension_employee,prmf_employee,employee_deductions,net_pay,employer_statutory_cost,calculation_snapshot
   FROM payroll_items WHERE payroll_run_id=$1 AND company_id=$2 ORDER BY employee_name`,[id,companyId]);
  return {...run.rows[0],items:items.rows};
 }
 async createRun(user:AuthenticatedUser,dto:{periodStart:string;periodEnd:string}){
  const membership=await this.membershipFor(user);this.assertCompanyWidePayroll(membership);
  if(!validDate(dto.periodStart)||!validDate(dto.periodEnd)||dto.periodEnd<dto.periodStart)throw new BadRequestException('Provide a valid periodStart and periodEnd (YYYY-MM-DD), with the end on or after the start.');
  const periodYear=Number(dto.periodStart.slice(0,4)),periodMonth=Number(dto.periodStart.slice(5,7));
  const expectedStart=`${dto.periodStart.slice(0,7)}-01`;
  const expectedEnd=new Date(Date.UTC(periodYear,periodMonth,0)).toISOString().slice(0,10);
  if(dto.periodStart!==expectedStart||dto.periodEnd!==expectedEnd||dto.periodStart.slice(0,7)!==dto.periodEnd.slice(0,7))throw new BadRequestException('Payroll periods must cover one complete calendar month, from its first through its last day.');
  // The current calculator implements NSSF Year 4 (effective February 2026) only.
  // Never silently apply those current rules to an earlier historical payroll period.
  if(dto.periodStart<'2026-02-01')throw new BadRequestException('Historical payroll periods before 2026-02-01 are not supported until effective-dated statutory rules are implemented and verified. No payroll was created.');
  const statutoryResult=await this.db.query(`SELECT nssf_method,nssf_employee_flat,nssf_employer_flat,nssf_employee_rate,nssf_employer_rate,nssf_pensionable_pay_cap,housing_levy_enabled,housing_levy_employee_rate,housing_levy_employer_rate
   FROM company_payroll_statutory_settings WHERE company_id=$1 AND effective_from<=$2::date ORDER BY effective_from DESC LIMIT 1`,[membership.companyId,dto.periodStart]);
  const statutoryRow=statutoryResult.rows[0];
  if(!statutoryRow)throw new BadRequestException('Company statutory payroll settings are not configured for this pay period. Save the applicable NSSF method and housing levy choice before generating payroll. No payroll was created.');
  if(typeof statutoryRow.housing_levy_enabled!=='boolean')throw new BadRequestException('Company statutory settings do not contain an explicit housing levy choice. Save the applicable settings before generating payroll. No payroll was created.');
  const statutoryOptions:PayrollStatutoryOptions={
   nssfMethod:String(statutoryRow.nssf_method??'YEAR4') as NssfMethod,
   nssfEmployeeFlat:Number(statutoryRow.nssf_employee_flat??200),
   nssfEmployerFlat:Number(statutoryRow.nssf_employer_flat??200),
   nssfEmployeeRate:Number(statutoryRow.nssf_employee_rate??.06),
   nssfEmployerRate:Number(statutoryRow.nssf_employer_rate??.06),
   nssfPensionablePayCap:Number(statutoryRow.nssf_pensionable_pay_cap??108000),
   housingLevyEnabled:statutoryRow.housing_levy_enabled,
   housingLevyEmployeeRate:Number(statutoryRow.housing_levy_employee_rate??.015),
   housingLevyEmployerRate:Number(statutoryRow.housing_levy_employer_rate??.015),
  };
  const missingPaySettings=await this.db.query<{missing_count:string|number}>(`SELECT COUNT(*)::int AS missing_count
   FROM employees e
   WHERE e.company_id=$1 AND e.employment_status='active'
     AND NOT EXISTS (SELECT 1 FROM employee_pay_settings s
       WHERE s.employee_id=e.id AND s.company_id=e.company_id AND s.effective_from <= $2::date)`,[membership.companyId,dto.periodStart]);
  const missingCount=Number(missingPaySettings.rows[0]?.missing_count??0);
  if(missingCount>0)throw new BadRequestException(`Payroll cannot be generated because ${missingCount} active employee(s) have no effective pay settings for this period. Configure pay for every active employee before generating payroll. No payroll was created.`);
  const employees=await this.db.query<PayEmployee>(`SELECT e.id,e.employee_number,e.first_name,e.last_name,
    s.monthly_basic_salary,s.monthly_taxable_allowances,s.monthly_taxable_benefits,s.employee_pension_contribution,
    s.post_retirement_medical_contribution,s.qualifying_mortgage_interest,s.eligible_insurance_premiums,s.resident_for_tax_purposes
    FROM employees e JOIN LATERAL (SELECT s.* FROM employee_pay_settings s WHERE s.employee_id=e.id AND s.company_id=e.company_id AND s.effective_from <= $2::date ORDER BY s.effective_from DESC LIMIT 1) s ON TRUE
    WHERE e.company_id=$1 AND e.employment_status='active'
    ORDER BY e.employee_number`,[membership.companyId,dto.periodStart]);
  if(!employees.rows.length)throw new BadRequestException('No active employees have effective pay settings. Configure employee pay before preparing a payroll run.');
  const calculated=employees.rows.map(employee=>{
    const grossCashPay=amount(employee.monthly_basic_salary)+amount(employee.monthly_taxable_allowances);
    const snapshot=calculateKenyaMonthlyPayroll({grossCashPay,taxableBenefits:amount(employee.monthly_taxable_benefits),
      employeePensionContribution:amount(employee.employee_pension_contribution),
      postRetirementMedicalContribution:amount(employee.post_retirement_medical_contribution),
      qualifyingMortgageInterest:amount(employee.qualifying_mortgage_interest),
      insurancePremiums:amount(employee.eligible_insurance_premiums),
      residentForTaxPurposes:employee.resident_for_tax_purposes,statutoryOptions});
    if(snapshot.netPay<0)throw new BadRequestException(`Calculated net pay is negative for employee ${employee.employee_number}; review their pay settings.`);
    return {employee,snapshot,grossCashPay};
  });
  try {
   return await this.db.transaction(async client=>{
    const inserted=await client.query(`INSERT INTO payroll_runs(company_id,period_start,period_end,status,employee_count,gross_total,employee_deductions_total,net_pay_total,employer_cost_total,created_by)
     VALUES($1,$2::date,$3::date,'draft',$4,$5,$6,$7,$8,$9) RETURNING id,company_id,period_start,period_end,status,employee_count,gross_total,employee_deductions_total,net_pay_total,employer_cost_total,created_at`,
    [membership.companyId,dto.periodStart,dto.periodEnd,calculated.length,
     calculated.reduce((s,x)=>s+x.grossCashPay+x.snapshot.taxableBenefits,0),
     calculated.reduce((s,x)=>s+x.snapshot.employeeDeductions,0),
     calculated.reduce((s,x)=>s+x.snapshot.netPay,0),
     calculated.reduce((s,x)=>s+x.grossCashPay+x.snapshot.taxableBenefits+x.snapshot.employerStatutoryCost,0),user.userId]);
    const run=inserted.rows[0];
    for(const {employee,snapshot,grossCashPay} of calculated){
      await client.query(`INSERT INTO payroll_items(company_id,payroll_run_id,employee_id,employee_number,employee_name,gross_cash_pay,taxable_benefits,nssf_employee,nssf_employer,shif_employee,housing_levy_employee,housing_levy_employer,paye,pension_employee,prmf_employee,employee_deductions,net_pay,employer_statutory_cost,calculation_snapshot)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)`,
      [membership.companyId,run.id,employee.id,employee.employee_number,`${employee.first_name} ${employee.last_name}`,grossCashPay,snapshot.taxableBenefits,snapshot.nssfEmployee,snapshot.nssfEmployer,snapshot.shifEmployee,snapshot.housingLevyEmployee,snapshot.housingLevyEmployer,snapshot.paye,snapshot.employeePensionContribution,snapshot.postRetirementMedicalContribution,snapshot.employeeDeductions,snapshot.netPay,snapshot.employerStatutoryCost,JSON.stringify(snapshot)]);
    }
    return run;
   });
  }catch(error){if((error as {code?:string}).code==='23505')throw new ConflictException('A payroll run already exists for this company and period.');throw error;}
 }

 /**
  * Produces tenant-scoped internal CSV support schedules from the immutable
  * payroll snapshot. These are not authority-specific filing files and must
  * not be represented as submitted returns or proof of remittance.
  */
 async exportAnnualTaxSummary(user:AuthenticatedUser,yearValue:string){
  if(!/^20\d{2}$/.test(yearValue)||Number(yearValue)<2026||Number(yearValue)>2100)throw new BadRequestException('year must be a four-digit year from 2026 to 2100. Earlier years require verified historical statutory rules.');
  const membership=await this.membershipFor(user);this.assertCompanyWidePayroll(membership);
  const {companyId}=membership;
  const result=await this.db.query(`SELECT i.employee_id,i.employee_number,i.employee_name,
    SUM(i.gross_cash_pay)::numeric(14,2) AS gross_cash_pay,
    SUM(i.taxable_benefits)::numeric(14,2) AS taxable_benefits,
    SUM(i.paye)::numeric(14,2) AS paye_withheld,
    SUM(i.nssf_employee)::numeric(14,2) AS employee_nssf,
    SUM(i.nssf_employer)::numeric(14,2) AS employer_nssf,
    SUM(i.shif_employee)::numeric(14,2) AS shif_contributions,
    SUM(i.housing_levy_employee)::numeric(14,2) AS employee_housing_levy,
    SUM(i.housing_levy_employer)::numeric(14,2) AS employer_housing_levy,
    SUM(i.pension_employee)::numeric(14,2) AS employee_pension,
    SUM(i.prmf_employee)::numeric(14,2) AS post_retirement_medical,
    SUM(i.employee_deductions)::numeric(14,2) AS total_employee_deductions,
    SUM(i.net_pay)::numeric(14,2) AS net_cash_pay,
    COUNT(DISTINCT r.id)::int AS posted_pay_periods
   FROM payroll_items i JOIN payroll_runs r ON r.id=i.payroll_run_id AND r.company_id=i.company_id
   WHERE i.company_id=$1 AND r.status='posted' AND r.period_start >= $2::date AND r.period_start < ($2::date + INTERVAL '1 year')
   GROUP BY i.employee_id,i.employee_number,i.employee_name ORDER BY i.employee_name,i.employee_number`,
  [companyId,`${yearValue}-01-01`]);
  const headers=['Employee number','Employee name','Tax year','Posted payroll periods','Gross cash pay KES','Taxable benefits KES','PAYE withheld KES','Employee NSSF KES','Employer NSSF KES','Employee SHIF KES','Employee housing levy KES','Employer housing levy KES','Employee pension KES','Post-retirement medical KES','Total employee deductions KES','Net cash pay KES'];
  const keys=['employee_number','employee_name','tax_year','posted_pay_periods','gross_cash_pay','taxable_benefits','paye_withheld','employee_nssf','employer_nssf','shif_contributions','employee_housing_levy','employer_housing_levy','employee_pension','post_retirement_medical','total_employee_deductions','net_cash_pay'];
  const csvCell=(value:unknown):string=>{const text=String(value??'');const safe=/^[=+@\t\r-]/.test(text)?"'"+text:text;return '"'+safe.replace(/"/g,'""')+'"';};
  const rows=result.rows.map((row:Record<string,unknown>)=>keys.map(key=>key==='tax_year'?yearValue:row[key]));
  const csv=[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
  return {filename:`omega-annual-tax-summary-${yearValue}.csv`,contentType:'text/csv; charset=utf-8',year:Number(yearValue),payrollRunsIncluded:'posted only',disclaimer:'Internal annual payroll summary aggregated from posted payroll snapshots. This is not an official KRA P9/P9A tax deduction card, P10 return, filing confirmation, or proof of tax remittance. Reconcile with payroll records and current KRA requirements before filing or issuing certificates.',csv};
 }
 async exportRunReport(user:AuthenticatedUser,id:string,reportType:string){
  const allowed=['payslips','paye','nssf','sha','housing'];
  if(!allowed.includes(reportType))throw new BadRequestException(`Unsupported report type. Choose: ${allowed.join(', ')}.`);
  const run=await this.getRun(user,id) as Record<string,unknown> & {items:Array<Record<string,unknown>>};
  const items=run.items;
  const csvCell=(value:unknown):string=>{const text=String(value??'');const safe=/^[=+@\t\r-]/.test(text)?"'"+text:text;return '"' + safe.replace(/"/g,'""') + '"';};
  let filename=`omega-payroll-${reportType}-${String(run.period_start).slice(0,10)}.csv`;
  let headers:string[]=[];
  let rows:unknown[][]=[];
  if(reportType==='payslips'){
   headers=['Employee number','Employee name','Pay period start','Pay period end','Gross cash pay KES','Taxable benefits KES','PAYE KES','Employee NSSF KES','Employee SHIF KES','Employee housing levy KES','Employee pension KES','Post-retirement medical KES','Total deductions KES','Net cash pay KES','Payroll status'];
   rows=items.map(x=>[x.employee_number,x.employee_name,run.period_start,run.period_end,x.gross_cash_pay,x.taxable_benefits,x.paye,x.nssf_employee,x.shif_employee,x.housing_levy_employee,x.pension_employee,x.prmf_employee,x.employee_deductions,x.net_pay,run.status]);
  }else if(reportType==='paye'){
   headers=['Employee number','Employee name','Pay period start','Pay period end','Gross cash pay KES','Taxable benefits KES','Taxable income KES','PAYE before relief KES','Personal relief KES','Insurance relief KES','PAYE withheld KES','Payroll status'];
   rows=items.map(x=>{const s=(x.calculation_snapshot||{}) as Record<string,unknown>;return [x.employee_number,x.employee_name,run.period_start,run.period_end,x.gross_cash_pay,x.taxable_benefits,s.taxableIncome,s.payeBeforeReliefs,s.personalRelief,s.insuranceRelief,x.paye,run.status];});
  }else if(reportType==='nssf'){
   headers=['Employee number','Employee name','Pay period start','Pay period end','Employee NSSF KES','Employer NSSF KES','Combined NSSF KES','Payroll status'];
   rows=items.map(x=>[x.employee_number,x.employee_name,run.period_start,run.period_end,x.nssf_employee,x.nssf_employer,Number(x.nssf_employee||0)+Number(x.nssf_employer||0),run.status]);
  }else if(reportType==='sha'){
   headers=['Employee number','Employee name','Pay period start','Pay period end','Employee SHIF contribution KES','Payroll status'];
   rows=items.map(x=>[x.employee_number,x.employee_name,run.period_start,run.period_end,x.shif_employee,run.status]);
  }else{
   headers=['Employee number','Employee name','Pay period start','Pay period end','Employee housing levy KES','Employer housing levy KES','Combined housing levy KES','Payroll status'];
   rows=items.map(x=>[x.employee_number,x.employee_name,run.period_start,run.period_end,x.housing_levy_employee,x.housing_levy_employer,Number(x.housing_levy_employee||0)+Number(x.housing_levy_employer||0),run.status]);
  }
  const csv=[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
  return {filename,contentType:'text/csv; charset=utf-8',disclaimer:'Internal payroll support schedule generated from the saved payroll calculation snapshot. Not an official authority filing, not proof of submission or payment, and may require authority-specific identifiers, templates, and review before use.',csv};
 }
 async approveRun(user:AuthenticatedUser,id:string){
  const membership=await this.membershipFor(user);this.assertCompanyWidePayroll(membership);
  return this.db.transaction(async client=>{
   const run=await client.query(`SELECT * FROM payroll_runs WHERE id=$1 AND company_id=$2 FOR UPDATE`,[id,membership.companyId]);
   if(!run.rows.length)throw new NotFoundException('Payroll run not found in this company.');
   if(run.rows[0].status!=='draft')throw new ConflictException('Only draft payroll runs can be approved.');
   const items=await client.query(`SELECT id,gross_cash_pay,taxable_benefits,nssf_employee,nssf_employer,shif_employee,housing_levy_employee,housing_levy_employer,paye,pension_employee,prmf_employee,employee_deductions,net_pay,employer_statutory_cost FROM payroll_items WHERE payroll_run_id=$1 AND company_id=$2 FOR UPDATE`,[id,membership.companyId]);
   if(!items.rows.length)throw new BadRequestException('Payroll run has no employee items.');
   this.assertRunTotalsReconcile(run.rows[0] as Record<string,unknown>,items.rows as Array<Record<string,unknown>>);
   const updated=await client.query(`UPDATE payroll_runs SET status='approved',approved_by=$3,approved_at=NOW(),updated_at=NOW() WHERE id=$1 AND company_id=$2 AND status='draft'
    RETURNING id,company_id,period_start,period_end,status,employee_count,gross_total,employee_deductions_total,net_pay_total,employer_cost_total,approved_by,approved_at`,[id,membership.companyId,user.userId]);
   return updated.rows[0];
  });
 }
 async postRun(user:AuthenticatedUser,id:string){
  const membership=await this.membershipFor(user);this.assertCompanyWidePayroll(membership);
  return this.db.transaction(async client=>{
   const runResult=await client.query('SELECT * FROM payroll_runs WHERE id=$1 AND company_id=$2 FOR UPDATE',[id,membership.companyId]);
   if(!runResult.rows.length)throw new NotFoundException('Payroll run not found in this company.');
   const run=runResult.rows[0];
   if(run.status!=='approved')throw new ConflictException('Only approved payroll runs can be posted. A posted or draft run cannot be posted again.');
   const itemsResult=await client.query('SELECT * FROM payroll_items WHERE payroll_run_id=$1 AND company_id=$2 ORDER BY employee_number FOR UPDATE',[id,membership.companyId]);
   const items=itemsResult.rows;
   if(!items.length)throw new BadRequestException('Payroll run has no employee items.');
   this.assertRunTotalsReconcile(run as Record<string,unknown>,items as Array<Record<string,unknown>>);
   const totals=items.reduce((t,x)=>({
    gross:t.gross+Number(x.gross_cash_pay),
    employerNssf:t.employerNssf+Number(x.nssf_employer),
    employerHousing:t.employerHousing+Number(x.housing_levy_employer),
    net:t.net+Number(x.net_pay),
    paye:t.paye+Number(x.paye),
    shif:t.shif+Number(x.shif_employee),
    nssf:t.nssf+Number(x.nssf_employee)+Number(x.nssf_employer),
    housing:t.housing+Number(x.housing_levy_employee)+Number(x.housing_levy_employer),
    pension:t.pension+Number(x.pension_employee),
    prmf:t.prmf+Number(x.prmf_employee),
   }),{gross:0,employerNssf:0,employerHousing:0,net:0,paye:0,shif:0,nssf:0,housing:0,pension:0,prmf:0});
   const money2=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
   const accounts=[
    ['5200','Salaries and Wages','expense','debit','payroll_wages'],
    ['5210','Employer Payroll Contributions','expense','debit','payroll_employer_contributions'],
    ['2200','Net Payroll Payable','liability','credit','payroll_net_payable'],
    ['2210','PAYE Payable','liability','credit','payroll_paye_payable'],
    ['2220','SHIF Payable','liability','credit','payroll_shif_payable'],
    ['2230','NSSF Payable','liability','credit','payroll_nssf_payable'],
    ['2240','Housing Levy Payable','liability','credit','payroll_housing_levy_payable'],
    ['2250','Employee Pension Payable','liability','credit','payroll_pension_payable'],
    ['2260','Post-Retirement Medical Payable','liability','credit','payroll_prmf_payable'],
   ] as const;
   for(const a of accounts)await client.query(`INSERT INTO chart_of_accounts(company_id,code,name,account_type,normal_side,system_code) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(company_id,code) DO NOTHING`,[membership.companyId,...a]);
   const accountRows=await client.query('SELECT id,system_code FROM chart_of_accounts WHERE company_id=$1 AND system_code=ANY($2::text[]) AND is_active=true',[membership.companyId,accounts.map(a=>a[4])]);
   const accountMap=new Map(accountRows.rows.map(a=>[a.system_code,a.id]));
   for(const a of accounts)if(!accountMap.has(a[4]))throw new BadRequestException(`Payroll account ${a[4]} is missing or inactive.`);
   const periodEnd=dateOnly(run.period_end);
   const year=Number(periodEnd.slice(0,4));
   const debitWages=money2(totals.gross);
   const debitEmployer=money2(totals.employerNssf+totals.employerHousing);
   const lines=[
    {system:'payroll_wages',description:'Gross cash earnings',debit:debitWages,credit:0},
    {system:'payroll_employer_contributions',description:'Employer NSSF and housing levy',debit:debitEmployer,credit:0},
    {system:'payroll_net_payable',description:'Net employee pay',debit:0,credit:money2(totals.net)},
    {system:'payroll_paye_payable',description:'PAYE withheld',debit:0,credit:money2(totals.paye)},
    {system:'payroll_shif_payable',description:'SHIF withheld',debit:0,credit:money2(totals.shif)},
    {system:'payroll_nssf_payable',description:'Employee and employer NSSF',debit:0,credit:money2(totals.nssf)},
    {system:'payroll_housing_levy_payable',description:'Employee and employer housing levy',debit:0,credit:money2(totals.housing)},
    {system:'payroll_pension_payable',description:'Employee pension contributions',debit:0,credit:money2(totals.pension)},
    {system:'payroll_prmf_payable',description:'Post-retirement medical contributions',debit:0,credit:money2(totals.prmf)},
   ].filter(line=>line.debit>0||line.credit>0);
   const totalDebits=money2(lines.reduce((s,l)=>s+l.debit,0));
   const totalCredits=money2(lines.reduce((s,l)=>s+l.credit,0));
   if(Math.abs(totalDebits-totalCredits)>0.01)throw new BadRequestException(`Payroll journal is not balanced (debits ${totalDebits}, credits ${totalCredits}).`);
   const seq=await client.query(`INSERT INTO payroll_journal_sequences(company_id,entry_year,next_number) VALUES($1,$2,2)
    ON CONFLICT(company_id,entry_year) DO UPDATE SET next_number=payroll_journal_sequences.next_number+1
    RETURNING next_number-1 AS allocated_number`,[membership.companyId,year]);
   const entryNumber=`PAY-${year}-${String(seq.rows[0].allocated_number).padStart(6,'0')}`;
   const journal=await client.query(`INSERT INTO journal_entries(company_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by)
    VALUES($1,$2,$3::date,$4,'payroll',$5,'posted',NOW(),$6) RETURNING id,entry_number,entry_date,status,posted_at`,
    [membership.companyId,entryNumber,periodEnd,`Payroll for ${dateOnly(run.period_start)} to ${periodEnd}`,id,user.userId]);
   for(const line of lines)await client.query(`INSERT INTO journal_entry_lines(company_id,journal_entry_id,account_id,description,debit,credit)
    VALUES($1,$2,$3,$4,$5,$6)`,[membership.companyId,journal.rows[0].id,accountMap.get(line.system),line.description,line.debit,line.credit]);
   const updated=await client.query(`UPDATE payroll_runs SET status='posted',journal_entry_id=$3,posted_by=$4,posted_at=NOW(),updated_at=NOW()
    WHERE id=$1 AND company_id=$2 AND status='approved'
    RETURNING id,company_id,period_start,period_end,status,employee_count,gross_total,employee_deductions_total,net_pay_total,employer_cost_total,journal_entry_id,posted_at`,
    [id,membership.companyId,journal.rows[0].id,user.userId]);
   if(!updated.rows.length)throw new ConflictException('Payroll run changed state before posting.');
   return {...updated.rows[0],journal:journal.rows[0],debits:totalDebits,credits:totalCredits,balanced:true};
  });
 }

}
