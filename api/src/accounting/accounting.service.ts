import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import type { CreateAccountDto } from './dto/create-account.dto.js';

const DEFAULT_ACCOUNTS = [
 {code:'1000',name:'Cash on Hand',type:'asset',side:'debit',system:'cash'},
 {code:'1010',name:'Bank Account',type:'asset',side:'debit',system:'bank'},
 {code:'1020',name:'M-Pesa Clearing',type:'asset',side:'debit',system:'mpesa'},
 {code:'1100',name:'Accounts Receivable',type:'asset',side:'debit',system:'accounts_receivable'},
 {code:'1200',name:'Inventory',type:'asset',side:'debit',system:'inventory'},
 {code:'1250',name:'Work in Progress',type:'asset',side:'debit',system:'work_in_progress'},
 {code:'1300',name:'Input VAT Recoverable',type:'asset',side:'debit',system:'input_tax'},
 {code:'2000',name:'Accounts Payable',type:'liability',side:'credit',system:'accounts_payable'},
 {code:'2050',name:'Customer Credits Payable',type:'liability',side:'credit',system:'customer_credits'},
 {code:'2010',name:'Goods Received Not Invoiced',type:'liability',side:'credit',system:'goods_received_not_invoiced'},
 {code:'2100',name:'Output VAT Payable',type:'liability',side:'credit',system:'output_tax'},
 {code:'3000',name:'Owner Equity',type:'equity',side:'credit',system:'equity'},
 {code:'4000',name:'Sales Revenue',type:'income',side:'credit',system:'sales_revenue'},
 {code:'5000',name:'Purchases and Cost of Goods',type:'expense',side:'debit',system:'purchases_expense'},
 {code:'5100',name:'Operating Expenses',type:'expense',side:'debit',system:'operating_expense'}
] as const;
@Injectable()
export class AccountingService {
 constructor(private readonly db:DatabaseService,private readonly memberships:MembershipsService,private readonly audit:AuditService){}
 private companyFor(user:AuthenticatedUser){return user.companyId?this.memberships.getMembershipForCompany(user.userId,user.companyId):this.memberships.getMembership(user.userId);}
 private assertCompanyWideAccounting(membership:{branchId?:string|null}){if(membership.branchId)throw new ForbiddenException('Accounting ledgers and reconciliations are company-wide. A company-wide accounting administrator must perform this action.');}
 async ensureDefaults(companyId:string){
  await this.db.transaction(async client=>{
   for(const a of DEFAULT_ACCOUNTS) await client.query(
    `INSERT INTO chart_of_accounts(company_id,code,name,account_type,normal_side,system_code)
     VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(company_id,code) DO NOTHING`,
    [companyId,a.code,a.name,a.type,a.side,a.system]);
  });
 }
 async listAccounts(user:AuthenticatedUser){
  const membership=await this.companyFor(user);this.assertCompanyWideAccounting(membership);
  const {companyId}=membership;
  return (await this.db.query(
   `SELECT a.id,a.company_id,a.code,a.name,a.account_type,a.normal_side,a.system_code,a.is_active,a.created_at,
    COALESCE(SUM(l.debit) FILTER (WHERE j.status='posted'),0)::numeric(14,2) AS total_debits,COALESCE(SUM(l.credit) FILTER (WHERE j.status='posted'),0)::numeric(14,2) AS total_credits,
    CASE WHEN a.normal_side='debit' THEN COALESCE(SUM(l.debit-l.credit) FILTER (WHERE j.status='posted'),0) ELSE COALESCE(SUM(l.credit-l.debit) FILTER (WHERE j.status='posted'),0) END::numeric(14,2) AS balance
    FROM chart_of_accounts a LEFT JOIN journal_entry_lines l ON l.account_id=a.id AND l.company_id=a.company_id
    LEFT JOIN journal_entries j ON j.id=l.journal_entry_id AND j.company_id=l.company_id AND j.status='posted'
    WHERE a.company_id=$1 GROUP BY a.id ORDER BY a.code`,[companyId])).rows;
 }
 async createAccount(user:AuthenticatedUser,dto:CreateAccountDto){
  const membership=await this.companyFor(user);this.assertCompanyWideAccounting(membership);
  const {companyId}=membership;await this.ensureDefaults(companyId);
  const side=dto.normalSide??(['liability','equity','income'].includes(dto.accountType)?'credit':'debit');
  try{
   const r=await this.db.query(`INSERT INTO chart_of_accounts(company_id,code,name,account_type,normal_side)
    VALUES($1,$2,$3,$4,$5) RETURNING *`,[companyId,dto.code.trim(),dto.name.trim(),dto.accountType,side]);
   const a=r.rows[0];
   await this.audit.log({userId:user.userId,companyId,branchId:null,action:'accounting.account.create',entityType:'chart_of_account',entityId:String(a.id),oldValues:null,newValues:{code:dto.code,name:dto.name},ipAddress:null});
   return a;
  }catch(e){if((e as {code?:string}).code==='23505')throw new ConflictException('An account with this code or system code already exists.');throw e;}
 }
 async trialBalance(user:AuthenticatedUser,asOfDate?:string){
  const membership=await this.companyFor(user);this.assertCompanyWideAccounting(membership);
  const {companyId}=membership;
  const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  if(asOfDate&&!validDate(asOfDate))throw new BadRequestException('asOfDate must be a valid YYYY-MM-DD date.');
  const result=await this.db.query<{id:string;code:string;name:string;account_type:string;normal_side:string;total_debits:string|number;total_credits:string|number;debit_balance:string|number;credit_balance:string|number}>(`SELECT a.id,a.code,a.name,a.account_type,a.normal_side,
    COALESCE(SUM(l.debit) FILTER (WHERE j.status='posted'),0)::numeric(14,2) AS total_debits,
    COALESCE(SUM(l.credit) FILTER (WHERE j.status='posted'),0)::numeric(14,2) AS total_credits,
    GREATEST(COALESCE(SUM(l.debit-l.credit) FILTER (WHERE j.status='posted'),0),0)::numeric(14,2) AS debit_balance,
    GREATEST(COALESCE(SUM(l.credit-l.debit) FILTER (WHERE j.status='posted'),0),0)::numeric(14,2) AS credit_balance
    FROM chart_of_accounts a
    LEFT JOIN journal_entry_lines l ON l.account_id=a.id AND l.company_id=a.company_id
    LEFT JOIN journal_entries j ON j.id=l.journal_entry_id AND j.company_id=l.company_id AND j.status='posted'
      AND ($2::date IS NULL OR j.entry_date <= $2::date)
    WHERE a.company_id=$1
    GROUP BY a.id
    ORDER BY a.code`,[companyId,asOfDate??null]);
  const accounts=result.rows.map(row=>({...row,total_debits:Number(row.total_debits),total_credits:Number(row.total_credits),debit_balance:Number(row.debit_balance),credit_balance:Number(row.credit_balance)}));
  const totalDebits=Math.round(accounts.reduce((sum,row)=>sum+row.debit_balance,0)*100)/100;
  const totalCredits=Math.round(accounts.reduce((sum,row)=>sum+row.credit_balance,0)*100)/100;
  const variance=Math.round((totalDebits-totalCredits)*100)/100;
  return {companyId,asOfDate:asOfDate??new Date().toISOString().slice(0,10),accounts,totalDebits,totalCredits,variance,balanced:Math.abs(variance)<=0.01};
 }
 async payablesReconciliation(user:AuthenticatedUser){
  const membership=await this.companyFor(user);this.assertCompanyWideAccounting(membership);
  const {companyId}=membership;
  const [control,subledger,aging]=await this.db.transaction(async client=>{
   await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   return Promise.all([
   client.query(`SELECT COALESCE(SUM(CASE WHEN a.normal_side='debit' THEN l.debit-l.credit ELSE l.credit-l.debit END) FILTER (WHERE j.status='posted'),0)::numeric(14,2) AS balance
    FROM chart_of_accounts a LEFT JOIN journal_entry_lines l ON l.account_id=a.id AND l.company_id=a.company_id
    LEFT JOIN journal_entries j ON j.id=l.journal_entry_id AND j.company_id=l.company_id AND j.status='posted'
    WHERE a.company_id=$1 AND a.system_code='accounts_payable' GROUP BY a.id`,[companyId]),
   client.query(`SELECT COALESCE(SUM(b.total-b.paid_amount),0)::numeric(14,2) AS balance
    FROM supplier_bills b WHERE b.company_id=$1 AND b.status<>'void'`,[companyId]),
   client.query(`SELECT
    COALESCE(SUM(CASE WHEN b.due_date IS NULL OR b.due_date>=CURRENT_DATE THEN b.total-b.paid_amount ELSE 0 END),0)::numeric(14,2) AS current,
    COALESCE(SUM(CASE WHEN b.due_date<CURRENT_DATE AND b.due_date>=CURRENT_DATE-30 THEN b.total-b.paid_amount ELSE 0 END),0)::numeric(14,2) AS days_1_to_30,
    COALESCE(SUM(CASE WHEN b.due_date<CURRENT_DATE-30 AND b.due_date>=CURRENT_DATE-60 THEN b.total-b.paid_amount ELSE 0 END),0)::numeric(14,2) AS days_31_to_60,
    COALESCE(SUM(CASE WHEN b.due_date<CURRENT_DATE-60 THEN b.total-b.paid_amount ELSE 0 END),0)::numeric(14,2) AS days_61_plus
    FROM supplier_bills b WHERE b.company_id=$1 AND b.status<>'void'`,[companyId])
   ]);
  });
  const controlBalance=Number(control.rows[0]?.balance??0),billBalance=Number(subledger.rows[0]?.balance??0);
  const variance=Math.round((controlBalance-billBalance)*100)/100;
  return {companyId,asOf:new Date().toISOString().slice(0,10),controlAccountBalance:controlBalance,supplierBillsBalance:billBalance,variance,reconciled:Math.abs(variance)<=0.01,ageing:{current:Number(aging.rows[0]?.current??0),days1to30:Number(aging.rows[0]?.days_1_to_30??0),days31to60:Number(aging.rows[0]?.days_31_to_60??0),days61plus:Number(aging.rows[0]?.days_61_plus??0)}};
 }

 async receivablesReconciliation(user:AuthenticatedUser){
  const membership=await this.companyFor(user);this.assertCompanyWideAccounting(membership);
  const {companyId}=membership;
  const [control,subledger,aging]=await this.db.transaction(async client=>{
   await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   return Promise.all([
   client.query(`SELECT COALESCE(SUM(CASE WHEN a.normal_side='debit' THEN l.debit-l.credit ELSE l.credit-l.debit END) FILTER (WHERE j.status='posted'),0)::numeric(14,2) AS balance
    FROM chart_of_accounts a LEFT JOIN journal_entry_lines l ON l.account_id=a.id AND l.company_id=a.company_id
    LEFT JOIN journal_entries j ON j.id=l.journal_entry_id AND j.company_id=l.company_id AND j.status='posted'
    WHERE a.company_id=$1 AND a.system_code='accounts_receivable' GROUP BY a.id`,[companyId]),
   client.query(`SELECT COALESCE(SUM(GREATEST(i.total-i.amount_paid-i.credited_amount,0)),0)::numeric(14,2) AS balance
    FROM invoices i WHERE i.company_id=$1 AND i.status NOT IN ('draft','cancelled')`,[companyId]),
   client.query(`SELECT
    COALESCE(SUM(CASE WHEN i.due_date>=CURRENT_DATE THEN GREATEST(i.total-i.amount_paid-i.credited_amount,0) ELSE 0 END),0)::numeric(14,2) AS current,
    COALESCE(SUM(CASE WHEN i.due_date<CURRENT_DATE AND i.due_date>=CURRENT_DATE-30 THEN GREATEST(i.total-i.amount_paid-i.credited_amount,0) ELSE 0 END),0)::numeric(14,2) AS days_1_to_30,
    COALESCE(SUM(CASE WHEN i.due_date<CURRENT_DATE-30 AND i.due_date>=CURRENT_DATE-60 THEN GREATEST(i.total-i.amount_paid-i.credited_amount,0) ELSE 0 END),0)::numeric(14,2) AS days_31_to_60,
    COALESCE(SUM(CASE WHEN i.due_date<CURRENT_DATE-60 THEN GREATEST(i.total-i.amount_paid-i.credited_amount,0) ELSE 0 END),0)::numeric(14,2) AS days_61_plus
    FROM invoices i WHERE i.company_id=$1 AND i.status NOT IN ('draft','cancelled')`,[companyId])
   ]);
  });
  const controlBalance=Number(control.rows[0]?.balance??0),invoiceBalance=Number(subledger.rows[0]?.balance??0);
  const variance=Math.round((controlBalance-invoiceBalance)*100)/100;
  return {companyId,asOf:new Date().toISOString().slice(0,10),controlAccountBalance:controlBalance,customerInvoicesBalance:invoiceBalance,variance,reconciled:Math.abs(variance)<=0.01,ageing:{current:Number(aging.rows[0]?.current??0),days1to30:Number(aging.rows[0]?.days_1_to_30??0),days31to60:Number(aging.rows[0]?.days_31_to_60??0),days61plus:Number(aging.rows[0]?.days_61_plus??0)}};
 }

 async listJournals(user:AuthenticatedUser){
  const membership=await this.companyFor(user);this.assertCompanyWideAccounting(membership);
  const {companyId}=membership;
  return (await this.db.query(`SELECT j.id,j.company_id,j.entry_number,j.entry_date,j.description,j.source_type,j.source_id,j.status,j.posted_at,j.created_at,
   COALESCE(SUM(l.debit),0)::numeric(14,2) AS total_debits,COALESCE(SUM(l.credit),0)::numeric(14,2) AS total_credits
   FROM journal_entries j LEFT JOIN journal_entry_lines l ON l.journal_entry_id=j.id AND l.company_id=j.company_id
   WHERE j.company_id=$1 GROUP BY j.id ORDER BY j.entry_date DESC,j.created_at DESC LIMIT 200`,[companyId])).rows;
 }
 async getJournal(user:AuthenticatedUser,id:string){
  const membership=await this.companyFor(user);this.assertCompanyWideAccounting(membership);
  const {companyId}=membership;
  const j=await this.db.query('SELECT * FROM journal_entries WHERE company_id=$1 AND id=$2',[companyId,id]);
  if(!j.rows[0])throw new NotFoundException('Journal entry not found.');
  const lines=await this.db.query(`SELECT l.*,a.code AS account_code,a.name AS account_name,a.account_type FROM journal_entry_lines l
   JOIN chart_of_accounts a ON a.id=l.account_id AND a.company_id=l.company_id
   WHERE l.company_id=$1 AND l.journal_entry_id=$2 ORDER BY a.code`,[companyId,id]);
  return {...j.rows[0],lines:lines.rows};
 }
}
