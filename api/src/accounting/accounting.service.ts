import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import type { PoolClient } from 'pg';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import type { CreateAccountDto } from './dto/create-account.dto.js';
import type { CreateJournalDto } from './dto/create-journal.dto.js';

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
 async ensureDefaults(companyId:string, transactionClient?:PoolClient){
  const ensure=async(client:PoolClient)=>{
   for(const a of DEFAULT_ACCOUNTS) await client.query(
    `INSERT INTO chart_of_accounts(company_id,code,name,account_type,normal_side,system_code)
     VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(company_id,code) DO NOTHING`,
    [companyId,a.code,a.name,a.type,a.side,a.system]);
  };
  if(transactionClient){await ensure(transactionClient);return;}
  await this.db.transaction(ensure);
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

 async createJournal(user: AuthenticatedUser, dto: CreateJournalDto) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  const entryDate = this.validateDate(dto.entryDate, 'entryDate');
  const description = dto.description.trim();
  if (!description) throw new BadRequestException('Journal description is required.');
  if (!Array.isArray(dto.lines) || dto.lines.length < 2) throw new BadRequestException('A journal entry requires at least two lines.');
  const lines = dto.lines.map((line, index) => {
   const debit = Math.round(Number(line.debit ?? 0) * 100) / 100;
   const credit = Math.round(Number(line.credit ?? 0) * 100) / 100;
   if (!line.accountId || !Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0 ||
       (debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
    throw new BadRequestException(`Journal line ${index + 1} must contain a valid account and exactly one positive debit or credit amount.`);
   }
   return { accountId: line.accountId, description: line.description?.trim() || description, debit, credit };
  });
  const debits = Math.round(lines.reduce((sum, line) => sum + line.debit, 0) * 100) / 100;
  const credits = Math.round(lines.reduce((sum, line) => sum + line.credit, 0) * 100) / 100;
  if (debits <= 0 || Math.abs(debits - credits) > 0.005) throw new BadRequestException('Journal debits and credits must be equal and greater than zero.');
  const id = await this.db.transaction(async client => {
   const accountIds = [...new Set(lines.map(line => line.accountId))];
   const accounts = await client.query<{ id: string }>(
    'SELECT id FROM chart_of_accounts WHERE company_id=$1 AND id=ANY($2::uuid[]) AND is_active=true FOR SHARE',
    [companyId, accountIds],
   );
   if (accounts.rows.length !== accountIds.length) throw new BadRequestException('Every journal account must be active and belong to this company.');
   const year = Number(entryDate.slice(0, 4));
   const sequence = await client.query<{ next_number: number }>(
    `INSERT INTO journal_entry_sequences(company_id,entry_year,next_number) VALUES($1,$2,1)
     ON CONFLICT(company_id,entry_year) DO UPDATE SET next_number=journal_entry_sequences.next_number+1 RETURNING next_number`,
    [companyId, year],
   );
   const entryNumber = `JE-${year}-${String(sequence.rows[0].next_number).padStart(6, '0')}`;
   const entry = await client.query<{ id: string }>(
    `INSERT INTO journal_entries(company_id,entry_number,entry_date,description,source_type,status,posted_at,posted_by)
     VALUES($1,$2,$3::date,$4,'manual_journal','posted',NOW(),$5) RETURNING id`,
    [companyId, entryNumber, entryDate, description, user.userId],
   );
   for (const line of lines) {
    await client.query(
     `INSERT INTO journal_entry_lines(company_id,journal_entry_id,account_id,description,debit,credit) VALUES($1,$2,$3,$4,$5,$6)`,
     [companyId, entry.rows[0].id, line.accountId, line.description, line.debit, line.credit],
    );
   }
   await this.audit.logInTransaction(client, {
    userId: user.userId, companyId, branchId: null, action: 'accounting.journal.create',
    entityType: 'journal_entry', entityId: entry.rows[0].id, oldValues: null,
    newValues: { entryNumber, entryDate, description, total: debits, lineCount: lines.length }, ipAddress: null,
   });
   return entry.rows[0].id;
  });
  return this.getJournal(user, id);
 }

 async reverseJournal(user: AuthenticatedUser, id: string, reversalDate?: string) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  const entryDate = this.validateDate(reversalDate ?? new Date().toISOString().slice(0, 10), 'reversalDate');
  const reversalId = await this.db.transaction(async client => {
   const originalResult = await client.query<{
    id: string; entry_number: string; description: string; source_type: string | null; status: string; reversal_journal_id: string | null;
   }>(
    'SELECT id,entry_number,description,source_type,status,reversal_journal_id FROM journal_entries WHERE company_id=$1 AND id=$2 FOR UPDATE',
    [companyId, id],
   );
   const original = originalResult.rows[0];
   if (!original) throw new NotFoundException('Journal entry not found.');
   if (original.status !== 'posted') throw new ConflictException('Only posted journal entries can be reversed.');
   if (original.reversal_journal_id) throw new ConflictException('This journal entry has already been reversed.');
   if (original.source_type === 'journal_reversal') {
    throw new BadRequestException('A reversal journal cannot itself be reversed. Post a correcting journal instead.');
   }
   const originalLines = await client.query<{
    account_id: string; description: string | null; debit: string | number; credit: string | number;
   }>(
    'SELECT account_id,description,debit,credit FROM journal_entry_lines WHERE company_id=$1 AND journal_entry_id=$2 ORDER BY id FOR UPDATE',
    [companyId, id],
   );
   if (originalLines.rows.length < 2) throw new BadRequestException('The original journal has no complete posting lines.');
   const year = Number(entryDate.slice(0, 4));
   const sequence = await client.query<{ next_number: number }>(
    `INSERT INTO journal_entry_sequences(company_id,entry_year,next_number) VALUES($1,$2,1)
     ON CONFLICT(company_id,entry_year) DO UPDATE SET next_number=journal_entry_sequences.next_number+1 RETURNING next_number`,
    [companyId, year],
   );
   const entryNumber = `JE-${year}-${String(sequence.rows[0].next_number).padStart(6, '0')}`;
   const reversal = await client.query<{ id: string }>(
    `INSERT INTO journal_entries(company_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by)
     VALUES($1,$2,$3::date,$4,'journal_reversal',$5,'posted',NOW(),$6) RETURNING id`,
    [companyId, entryNumber, entryDate, `Reversal: ${original.description}`, id, user.userId],
   );
   for (const line of originalLines.rows) {
    await client.query(
     `INSERT INTO journal_entry_lines(company_id,journal_entry_id,account_id,description,debit,credit) VALUES($1,$2,$3,$4,$5,$6)`,
     [companyId, reversal.rows[0].id, line.account_id, `Reversal: ${line.description ?? original.description}`, Number(line.credit), Number(line.debit)],
    );
   }
   await client.query(
    'UPDATE journal_entries SET reversal_journal_id=$1,reversed_at=NOW(),reversed_by=$2 WHERE company_id=$3 AND id=$4 AND reversal_journal_id IS NULL',
    [reversal.rows[0].id, user.userId, companyId, id],
   );
   await this.audit.logInTransaction(client, {
    userId: user.userId, companyId, branchId: null, action: 'accounting.journal.reverse',
    entityType: 'journal_entry', entityId: id, oldValues: { status: original.status, reversalJournalId: null },
    newValues: { status: 'reversed', reversalJournalId: reversal.rows[0].id, reversalDate: entryDate }, ipAddress: null,
   });
   return reversal.rows[0].id;
  });
  return this.getJournal(user, reversalId);
 }

 async vatSummary(user: AuthenticatedUser, startDate: string, endDate: string) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  this.validateDate(startDate, 'startDate');
  this.validateDate(endDate, 'endDate');
  if (startDate > endDate) throw new BadRequestException('startDate must be on or before endDate.');
  const currency = await this.getCompanyCurrency(companyId);
  const result = await this.db.query<{ input_vat: string | number; output_vat: string | number }>(
   `SELECT
     COALESCE(SUM(l.debit-l.credit) FILTER (WHERE a.system_code='input_tax'),0)::numeric(14,2) AS input_vat,
     COALESCE(SUM(l.credit-l.debit) FILTER (WHERE a.system_code='output_tax'),0)::numeric(14,2) AS output_vat
    FROM chart_of_accounts a
    JOIN journal_entry_lines l ON l.account_id=a.id AND l.company_id=a.company_id
    JOIN journal_entries j ON j.id=l.journal_entry_id AND j.company_id=l.company_id
    WHERE a.company_id=$1 AND a.system_code IN ('input_tax','output_tax')
      AND j.status='posted' AND j.entry_date>=$2::date AND j.entry_date<=$3::date`,
   [companyId, startDate, endDate],
  );
  const inputVat = Number(result.rows[0]?.input_vat ?? 0);
  const outputVat = Number(result.rows[0]?.output_vat ?? 0);
  return { companyId, currency, startDate, endDate, inputVat, outputVat, netVatPayable: Math.round((outputVat - inputVat) * 100) / 100 };
 }

 async listJournals(user:AuthenticatedUser){
  const membership=await this.companyFor(user);this.assertCompanyWideAccounting(membership);
  const {companyId}=membership;
  return (await this.db.query(`SELECT j.id,j.company_id,j.entry_number,j.entry_date,j.description,j.source_type,j.source_id,CASE WHEN j.reversal_journal_id IS NOT NULL THEN 'reversed' ELSE j.status END AS status,j.reversal_journal_id,j.reversed_at,j.posted_at,j.created_at,
   COALESCE(SUM(l.debit),0)::numeric(14,2) AS total_debits,COALESCE(SUM(l.credit),0)::numeric(14,2) AS total_credits
   FROM journal_entries j LEFT JOIN journal_entry_lines l ON l.journal_entry_id=j.id AND l.company_id=j.company_id
   WHERE j.company_id=$1 GROUP BY j.id ORDER BY j.entry_date DESC,j.created_at DESC LIMIT 200`,[companyId])).rows;
 }
 async getJournal(user:AuthenticatedUser,id:string){
  const membership=await this.companyFor(user);this.assertCompanyWideAccounting(membership);
  const {companyId}=membership;
  const j=await this.db.query('SELECT j.*,CASE WHEN j.reversal_journal_id IS NOT NULL THEN true ELSE false END AS is_reversed FROM journal_entries j WHERE j.company_id=$1 AND j.id=$2',[companyId,id]);
  if(!j.rows[0])throw new NotFoundException('Journal entry not found.');
  const lines=await this.db.query(`SELECT l.*,a.code AS account_code,a.name AS account_name,a.account_type FROM journal_entry_lines l
   JOIN chart_of_accounts a ON a.id=l.account_id AND a.company_id=l.company_id
   WHERE l.company_id=$1 AND l.journal_entry_id=$2 ORDER BY a.code`,[companyId,id]);
  return {...j.rows[0],lines:lines.rows};
 }

 private validateDate(date: string, label: string): string {
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date)
   && !Number.isNaN(Date.parse(date + 'T00:00:00Z'))
   && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date;
  if (!valid) throw new BadRequestException(`${label} must be a valid YYYY-MM-DD date.`);
  return date;
 }

 private async getCompanyCurrency(companyId: string): Promise<string> {
  const r = await this.db.query<{ currency: string | null }>(
   'SELECT currency FROM companies WHERE id=$1', [companyId]);
  return r.rows[0]?.currency || 'KES';
 }

 async profitAndLoss(user: AuthenticatedUser, startDate: string, endDate: string) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  this.validateDate(startDate, 'startDate');
  this.validateDate(endDate, 'endDate');
  if (startDate > endDate) throw new BadRequestException('startDate must be on or before endDate.');

  const currency = await this.getCompanyCurrency(companyId);

  const accounts = await this.db.query<{
   id: string; code: string; name: string; account_type: string;
   system_code: string | null; balance: string | number;
  }>(`SELECT a.id, a.code, a.name, a.account_type, a.system_code,
    CASE WHEN a.normal_side='debit'
     THEN COALESCE(SUM(l.debit-l.credit) FILTER (WHERE j.status='posted' AND j.entry_date>=$2::date AND j.entry_date<=$3::date),0)
     ELSE COALESCE(SUM(l.credit-l.debit) FILTER (WHERE j.status='posted' AND j.entry_date>=$2::date AND j.entry_date<=$3::date),0)
    END::numeric(14,2) AS balance
   FROM chart_of_accounts a
   LEFT JOIN journal_entry_lines l ON l.account_id=a.id AND l.company_id=a.company_id
   LEFT JOIN journal_entries j ON j.id=l.journal_entry_id AND j.company_id=l.company_id
   WHERE a.company_id=$1 AND a.account_type IN ('income','expense')
   GROUP BY a.id ORDER BY a.code`,
   [companyId, startDate, endDate]);

  const rows = accounts.rows.map(r => ({ ...r, balance: Number(r.balance) }));
  const incomeAccounts = rows.filter(a => a.account_type === 'income');
  const expenseAccounts = rows.filter(a => a.account_type === 'expense');
  const totalIncome = incomeAccounts.reduce((s, a) => s + a.balance, 0);
  const totalExpenses = expenseAccounts.reduce((s, a) => s + a.balance, 0);

  const isCostOfSales = (a: { system_code: string | null }) =>
   a.system_code === 'purchases_expense' || a.system_code === 'cost_of_sales';

  const costOfSales = expenseAccounts.filter(isCostOfSales).reduce((s, a) => s + a.balance, 0);
  const operatingExpenses = expenseAccounts.filter(a => !isCostOfSales(a)).reduce((s, a) => s + a.balance, 0);
  const grossProfit = totalIncome - costOfSales;
  const netProfit = totalIncome - totalExpenses;

  return {
   currency, startDate, endDate,
   incomeAccounts, expenseAccounts,
   totalIncome, costOfSales, grossProfit, operatingExpenses,
   totalExpenses, netProfit,
  };
 }

 async balanceSheet(user: AuthenticatedUser, asOfDate: string) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  this.validateDate(asOfDate, 'asOfDate');

  const currency = await this.getCompanyCurrency(companyId);

  const accounts = await this.db.query<{
   id: string; code: string; name: string; account_type: string;
   system_code: string | null; balance: string | number;
  }>(`SELECT a.id, a.code, a.name, a.account_type, a.system_code,
    CASE WHEN a.normal_side='debit'
     THEN COALESCE(SUM(l.debit-l.credit) FILTER (WHERE j.status='posted' AND j.entry_date<=$2::date),0)
     ELSE COALESCE(SUM(l.credit-l.debit) FILTER (WHERE j.status='posted' AND j.entry_date<=$2::date),0)
    END::numeric(14,2) AS balance
   FROM chart_of_accounts a
   LEFT JOIN journal_entry_lines l ON l.account_id=a.id AND l.company_id=a.company_id
   LEFT JOIN journal_entries j ON j.id=l.journal_entry_id AND j.company_id=l.company_id
   WHERE a.company_id=$1 AND a.account_type IN ('asset','liability','equity')
   GROUP BY a.id ORDER BY a.code`,
   [companyId, asOfDate]);

  const rows = accounts.rows.map(r => ({ ...r, balance: Number(r.balance) }));
  const assetAccounts = rows.filter(a => a.account_type === 'asset');
  const liabilityAccounts = rows.filter(a => a.account_type === 'liability');
  const equityAccounts = rows.filter(a => a.account_type === 'equity');

  const totalAssets = assetAccounts.reduce((s, a) => s + a.balance, 0);
  const totalLiabilities = liabilityAccounts.reduce((s, a) => s + a.balance, 0);
  const totalEquity = equityAccounts.reduce((s, a) => s + a.balance, 0);
  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
  const variance = Math.round((totalAssets - totalLiabilitiesAndEquity) * 100) / 100;

  return {
   currency, asOfDate,
   assetAccounts, liabilityAccounts, equityAccounts,
   totalAssets, totalLiabilities, totalEquity,
   totalLiabilitiesAndEquity, variance,
   balanced: Math.abs(variance) <= 0.01,
  };
 }

 async cashFlow(user: AuthenticatedUser, startDate: string, endDate: string) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  this.validateDate(startDate, 'startDate');
  this.validateDate(endDate, 'endDate');
  if (startDate > endDate) throw new BadRequestException('startDate must be on or before endDate.');

  const currency = await this.getCompanyCurrency(companyId);

  const result = await this.db.query<{
   account_code: string; account_name: string; opening_balance: string | number;
   closing_balance: string | number; net_movement: string | number;
  }>(`SELECT a.code AS account_code, a.name AS account_name,
    COALESCE(SUM(CASE WHEN a.normal_side='debit' THEN l.debit-l.credit ELSE l.credit-l.debit END)
     FILTER (WHERE j.status='posted' AND j.entry_date<$2::date),0)::numeric(14,2) AS opening_balance,
    COALESCE(SUM(CASE WHEN a.normal_side='debit' THEN l.debit-l.credit ELSE l.credit-l.debit END)
     FILTER (WHERE j.status='posted' AND j.entry_date<=$3::date),0)::numeric(14,2) AS closing_balance,
    COALESCE(SUM(CASE WHEN a.normal_side='debit' THEN l.debit-l.credit ELSE l.credit-l.debit END)
     FILTER (WHERE j.status='posted' AND j.entry_date>=$2::date AND j.entry_date<=$3::date),0)::numeric(14,2) AS net_movement
   FROM chart_of_accounts a
   LEFT JOIN journal_entry_lines l ON l.account_id=a.id AND l.company_id=a.company_id
   LEFT JOIN journal_entries j ON j.id=l.journal_entry_id AND j.company_id=l.company_id
   WHERE a.company_id=$1 AND a.account_type='asset'
    AND a.system_code IN ('cash','bank','mpesa')
    AND a.is_active=true
   GROUP BY a.id ORDER BY a.code`,
   [companyId, startDate, endDate]);

  const cashAccounts = result.rows.map(r => ({
   account_code: r.account_code,
   account_name: r.account_name,
   opening_balance: Number(r.opening_balance),
   closing_balance: Number(r.closing_balance),
   net_movement: Number(r.net_movement),
  }));
  const totalOpening = cashAccounts.reduce((s, a) => s + a.opening_balance, 0);
  const totalClosing = cashAccounts.reduce((s, a) => s + a.closing_balance, 0);
  const netCashMovement = Math.round((totalClosing - totalOpening) * 100) / 100;

  return {
   currency, startDate, endDate, cashAccounts,
   totalOpeningBalance: totalOpening,
   totalClosingBalance: totalClosing,
   netCashMovement,
   method: 'direct',
   limitation: 'Category-level breakdown (operating/investing/financing) is not available because journal entries lack cash-flow classification tags. This report shows net cash movement for cash, bank, and M-Pesa accounts only.',
  };
 }
}
