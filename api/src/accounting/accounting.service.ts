import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import type { PoolClient } from 'pg';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import type { CreateAccountDto } from './dto/create-account.dto.js';
import type { CreateJournalDto } from './dto/create-journal.dto.js';
import type { CreateBankStatementDto } from './dto/create-bank-statement.dto.js';
import type { CreateFixedAssetDto } from './dto/fixed-assets.dto.js';
import type { CreateBudgetDto, CreateCostCentreDto } from './dto/budgets-cost-centres.dto.js';

const DEFAULT_ACCOUNTS = [
 {code:'1000',name:'Cash on Hand',type:'asset',side:'debit',system:'cash',cashFlowCategory:null},
 {code:'1010',name:'Bank Account',type:'asset',side:'debit',system:'bank',cashFlowCategory:null},
 {code:'1020',name:'M-Pesa Clearing',type:'asset',side:'debit',system:'mpesa',cashFlowCategory:null},
 {code:'1100',name:'Accounts Receivable',type:'asset',side:'debit',system:'accounts_receivable',cashFlowCategory:'operating'},
 {code:'1200',name:'Inventory',type:'asset',side:'debit',system:'inventory',cashFlowCategory:'operating'},
 {code:'1250',name:'Work in Progress',type:'asset',side:'debit',system:'work_in_progress',cashFlowCategory:'operating'},
 {code:'1300',name:'Input VAT Recoverable',type:'asset',side:'debit',system:'input_tax',cashFlowCategory:'operating'},
 {code:'1500',name:'Fixed Assets',type:'asset',side:'debit',system:'fixed_assets',cashFlowCategory:'investing'},
 {code:'1590',name:'Accumulated Depreciation',type:'asset',side:'credit',system:'accumulated_depreciation',cashFlowCategory:'investing'},
 {code:'2000',name:'Accounts Payable',type:'liability',side:'credit',system:'accounts_payable',cashFlowCategory:'operating'},
 {code:'2050',name:'Customer Credits Payable',type:'liability',side:'credit',system:'customer_credits',cashFlowCategory:'operating'},
 {code:'2010',name:'Goods Received Not Invoiced',type:'liability',side:'credit',system:'goods_received_not_invoiced',cashFlowCategory:'operating'},
 {code:'2100',name:'Output VAT Payable',type:'liability',side:'credit',system:'output_tax',cashFlowCategory:'operating'},
 {code:'2060',name:'Withholding Tax Payable',type:'liability',side:'credit',system:'withholding_tax_payable',cashFlowCategory:'operating'},
 {code:'3000',name:'Owner Equity',type:'equity',side:'credit',system:'equity',cashFlowCategory:'financing'},
 {code:'4000',name:'Sales Revenue',type:'income',side:'credit',system:'sales_revenue',cashFlowCategory:'operating'},
 {code:'5000',name:'Purchases and Cost of Goods',type:'expense',side:'debit',system:'purchases_expense',cashFlowCategory:'operating'},
 {code:'5100',name:'Operating Expenses',type:'expense',side:'debit',system:'operating_expense',cashFlowCategory:'operating'},
 {code:'5200',name:'Depreciation Expense',type:'expense',side:'debit',system:'depreciation_expense',cashFlowCategory:'operating'}
] as const;
@Injectable()
export class AccountingService {
 constructor(private readonly db:DatabaseService,private readonly memberships:MembershipsService,private readonly audit:AuditService){}
 private companyFor(user:AuthenticatedUser){return user.companyId?this.memberships.getMembershipForCompany(user.userId,user.companyId):this.memberships.getMembership(user.userId);}
 private assertCompanyWideAccounting(membership:{branchId?:string|null}){if(membership.branchId)throw new ForbiddenException('Accounting ledgers and reconciliations are company-wide. A company-wide accounting administrator must perform this action.');}
 async ensureDefaults(companyId:string, transactionClient?:PoolClient){
  const ensure=async(client:PoolClient)=>{
   for(const a of DEFAULT_ACCOUNTS) await client.query(
    `INSERT INTO chart_of_accounts(company_id,code,name,account_type,normal_side,system_code,cash_flow_category)
     VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(company_id,code) DO NOTHING`,
    [companyId,a.code,a.name,a.type,a.side,a.system,a.cashFlowCategory]);
  };
  if(transactionClient){await ensure(transactionClient);return;}
  await this.db.transaction(ensure);
 }
 async listAccounts(user:AuthenticatedUser){
  const membership=await this.companyFor(user);this.assertCompanyWideAccounting(membership);
  const {companyId}=membership;
  return (await this.db.query(
   `SELECT a.id,a.company_id,a.code,a.name,a.account_type,a.normal_side,a.system_code,a.cash_flow_category,a.is_active,a.created_at,
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

 async listCostCentres(user:AuthenticatedUser) {
  const membership=await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  return (await this.db.query(
   'SELECT id,code,name,description,is_active,created_at FROM cost_centres WHERE company_id=$1 ORDER BY is_active DESC,code',
   [membership.companyId],
  )).rows;
 }

 async createCostCentre(user:AuthenticatedUser,dto:CreateCostCentreDto) {
  const membership=await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const code=dto.code.trim().toUpperCase();
  const name=dto.name.trim();
  if(!code||!name)throw new BadRequestException('Cost centre code and name are required.');
  const result=await this.db.query(
   `INSERT INTO cost_centres(company_id,code,name,description,created_by)
    VALUES($1,$2,$3,$4,$5) RETURNING id,code,name,description,is_active,created_at`,
   [membership.companyId,code,name,dto.description?.trim()||null,user.userId],
  );
  await this.audit.log({userId:user.userId,companyId:membership.companyId,branchId:null,action:'accounting.cost_centre.create',entityType:'cost_centre',entityId:result.rows[0].id,oldValues:null,newValues:{code,name},ipAddress:null});
  return result.rows[0];
 }

 async createBudget(user:AuthenticatedUser,dto:CreateBudgetDto) {
  const membership=await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const {companyId}=membership;
  const amount=Math.round(Number(dto.budgetAmount)*100)/100;
  if(!Number.isFinite(amount)||amount<0)throw new BadRequestException('Budget amount must be a valid non-negative amount.');
  const id=await this.db.transaction(async client=>{
   const account=await client.query<{id:string;account_type:string}>(
    `SELECT id,account_type FROM chart_of_accounts WHERE company_id=$1 AND id=$2 AND is_active=true AND account_type IN ('income','expense') FOR SHARE`,
    [companyId,dto.accountId],
   );
   if(!account.rows[0])throw new BadRequestException('Budgets can only be assigned to active income or expense accounts in this company.');
   if(dto.costCentreId){
    const centre=await client.query<{id:string}>(
     'SELECT id FROM cost_centres WHERE company_id=$1 AND id=$2 AND is_active=true FOR SHARE',
     [companyId,dto.costCentreId],
    );
    if(!centre.rows[0])throw new BadRequestException('Select an active cost centre in this company.');
   }
   const result=await client.query<{id:string}>(
    `INSERT INTO budgets(company_id,fiscal_year,period_month,account_id,cost_centre_id,budget_amount,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [companyId,dto.fiscalYear,dto.periodMonth,dto.accountId,dto.costCentreId??null,amount,user.userId],
   );
   await this.audit.logInTransaction(client,{userId:user.userId,companyId,branchId:null,action:'accounting.budget.create',entityType:'budget',entityId:result.rows[0].id,oldValues:null,newValues:{fiscalYear:dto.fiscalYear,periodMonth:dto.periodMonth,accountId:dto.accountId,costCentreId:dto.costCentreId??null,budgetAmount:amount},ipAddress:null});
   return result.rows[0].id;
  });
  return this.budgetVsActual(user,dto.fiscalYear,dto.periodMonth).then(rows=>rows.find(row=>row.id===id));
 }

 async approveBudget(user:AuthenticatedUser,id:string) {
  const membership=await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const {companyId}=membership;
  const result=await this.db.transaction(async client=>{
   const budget=await client.query<{id:string;status:string}>(
    'SELECT id,status FROM budgets WHERE company_id=$1 AND id=$2 FOR UPDATE',
    [companyId,id],
   );
   if(!budget.rows[0])throw new NotFoundException('Budget line not found.');
   if(budget.rows[0].status!=='draft')throw new ConflictException('Only draft budget lines can be approved.');
   await client.query("UPDATE budgets SET status='approved',updated_at=NOW() WHERE company_id=$1 AND id=$2",[companyId,id]);
   await this.audit.logInTransaction(client,{userId:user.userId,companyId,branchId:null,action:'accounting.budget.approve',entityType:'budget',entityId:id,oldValues:{status:'draft'},newValues:{status:'approved'},ipAddress:null});
   return id;
  });
  const rows=await this.budgetVsActual(user);
  return rows.find(row=>row.id===result);
 }

 async budgetVsActual(user:AuthenticatedUser,fiscalYear?:number,periodMonth?:number) {
  const membership=await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const params:unknown[]=[membership.companyId];
  let filter='';
  if(fiscalYear!==undefined){params.push(fiscalYear);filter+=' AND b.fiscal_year=
  const membership=await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  return (await this.db.query(
   `SELECT f.*,asset_account.code AS asset_account_code,asset_account.name AS asset_account_name,
      accumulated_account.name AS accumulated_depreciation_account_name,
      expense_account.name AS depreciation_expense_account_name,payment_account.name AS payment_account_name,
      (f.cost-f.accumulated_depreciation)::numeric(14,2) AS net_book_value
    FROM fixed_assets f
    JOIN chart_of_accounts asset_account ON asset_account.id=f.asset_account_id AND asset_account.company_id=f.company_id
    JOIN chart_of_accounts accumulated_account ON accumulated_account.id=f.accumulated_depreciation_account_id AND accumulated_account.company_id=f.company_id
    JOIN chart_of_accounts expense_account ON expense_account.id=f.depreciation_expense_account_id AND expense_account.company_id=f.company_id
    JOIN chart_of_accounts payment_account ON payment_account.id=f.payment_account_id AND payment_account.company_id=f.company_id
    WHERE f.company_id=$1 ORDER BY f.status,f.asset_code`,
   [membership.companyId],
  )).rows;
 }

 async getFixedAsset(user: AuthenticatedUser,id:string) {
  const membership=await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const header=await this.db.query(
   `SELECT f.*,asset_account.code AS asset_account_code,asset_account.name AS asset_account_name,
      accumulated_account.name AS accumulated_depreciation_account_name,
      expense_account.name AS depreciation_expense_account_name,payment_account.name AS payment_account_name,
      (f.cost-f.accumulated_depreciation)::numeric(14,2) AS net_book_value
    FROM fixed_assets f
    JOIN chart_of_accounts asset_account ON asset_account.id=f.asset_account_id AND asset_account.company_id=f.company_id
    JOIN chart_of_accounts accumulated_account ON accumulated_account.id=f.accumulated_depreciation_account_id AND accumulated_account.company_id=f.company_id
    JOIN chart_of_accounts expense_account ON expense_account.id=f.depreciation_expense_account_id AND expense_account.company_id=f.company_id
    JOIN chart_of_accounts payment_account ON payment_account.id=f.payment_account_id AND payment_account.company_id=f.company_id
    WHERE f.company_id=$1 AND f.id=$2`,
   [membership.companyId,id],
  );
  if(!header.rows[0])throw new NotFoundException('Fixed asset not found.');
  const schedule=await this.db.query(
   `SELECT d.*,j.entry_number FROM fixed_asset_depreciation d
    JOIN journal_entries j ON j.id=d.journal_entry_id AND j.company_id=d.company_id
    WHERE d.company_id=$1 AND d.asset_id=$2 ORDER BY d.period_end`,
   [membership.companyId,id],
  );
  return {...header.rows[0],depreciationSchedule:schedule.rows};
 }

 async createFixedAsset(user:AuthenticatedUser,dto:CreateFixedAssetDto) {
  const membership=await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const {companyId}=membership;
  const acquisitionDate=this.validateDate(dto.acquisitionDate,'acquisitionDate');
  const cost=Math.round(Number(dto.cost)*100)/100;
  const residualValue=Math.round(Number(dto.residualValue??0)*100)/100;
  const usefulLifeMonths=Number(dto.usefulLifeMonths);
  if(!Number.isFinite(cost)||cost<=0||!Number.isFinite(residualValue)||residualValue<0||residualValue>cost||!Number.isInteger(usefulLifeMonths)||usefulLifeMonths<1)throw new BadRequestException('Enter a positive asset cost, a valid residual value and a whole-number useful life in months.');
  const assetCode=dto.assetCode.trim();
  const name=dto.name.trim();
  if(!assetCode||!name)throw new BadRequestException('Asset code and name are required.');
  const id=await this.db.transaction(async client=>{
   await this.ensureDefaults(companyId,client);
   const accountIds=[dto.assetAccountId,dto.accumulatedDepreciationAccountId,dto.depreciationExpenseAccountId,dto.paymentAccountId];
   if(new Set(accountIds).size!==4)throw new BadRequestException('Select four distinct ledger accounts for the asset.');
   const accounts=await client.query<{id:string;account_type:string;normal_side:string;system_code:string|null}>(
    'SELECT id,account_type,normal_side,system_code FROM chart_of_accounts WHERE company_id=$1 AND id=ANY($2::uuid[]) AND is_active=true FOR SHARE',
    [companyId,accountIds],
   );
   if(accounts.rows.length!==4)throw new BadRequestException('All fixed asset ledger accounts must be active and belong to this company.');
   const byId=new Map(accounts.rows.map(a=>[a.id,a]));
   if(byId.get(dto.assetAccountId)?.account_type!=='asset')throw new BadRequestException('The fixed asset account must be an asset account.');
   if(byId.get(dto.accumulatedDepreciationAccountId)?.account_type!=='asset'||byId.get(dto.accumulatedDepreciationAccountId)?.normal_side!=='credit')throw new BadRequestException('Accumulated depreciation must use a credit-normal asset account.');
   if(byId.get(dto.depreciationExpenseAccountId)?.account_type!=='expense')throw new BadRequestException('Depreciation must use an expense account.');
   const paymentAccount=byId.get(dto.paymentAccountId);
   if(paymentAccount?.account_type!=='asset'||!['cash','bank','mpesa'].includes(paymentAccount.system_code??''))throw new BadRequestException('Select an active cash, bank or M-Pesa ledger account for the acquisition payment.');
   const asset=await client.query<{id:string}>(
    `INSERT INTO fixed_assets(company_id,asset_code,name,description,acquisition_date,cost,residual_value,useful_life_months,
      asset_account_id,accumulated_depreciation_account_id,depreciation_expense_account_id,payment_account_id,created_by)
     VALUES($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [companyId,assetCode,name,dto.description?.trim()||null,acquisitionDate,cost,residualValue,usefulLifeMonths,
     dto.assetAccountId,dto.accumulatedDepreciationAccountId,dto.depreciationExpenseAccountId,dto.paymentAccountId,user.userId],
   );
   const year=Number(acquisitionDate.slice(0,4));
   const sequence=await client.query<{next_number:number}>(
    `INSERT INTO journal_entry_sequences(company_id,entry_year,next_number) VALUES($1,$2,1)
     ON CONFLICT(company_id,entry_year) DO UPDATE SET next_number=journal_entry_sequences.next_number+1 RETURNING next_number`,
    [companyId,year],
   );
   const entryNumber=`JE-${year}-${String(sequence.rows[0].next_number).padStart(6,'0')}`;
   const journal=await client.query<{id:string}>(
    `INSERT INTO journal_entries(company_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by)
     VALUES($1,$2,$3::date,$4,'fixed_asset_acquisition',$5,'posted',NOW(),$6) RETURNING id`,
    [companyId,entryNumber,acquisitionDate,`Acquire fixed asset ${assetCode} - ${name}`,asset.rows[0].id,user.userId],
   );
   await client.query(
    `INSERT INTO journal_entry_lines(company_id,journal_entry_id,account_id,description,debit,credit)
     VALUES($1,$2,$3,$4,$5,0),($1,$2,$6,$7,0,$5)`,
    [companyId,journal.rows[0].id,dto.assetAccountId,`Capitalise asset ${assetCode}`,cost,dto.paymentAccountId,`Cash/bank payment for asset ${assetCode}`],
   );
   await client.query('UPDATE fixed_assets SET acquisition_journal_entry_id=$1 WHERE company_id=$2 AND id=$3',[journal.rows[0].id,companyId,asset.rows[0].id]);
   await this.audit.logInTransaction(client,{
    userId:user.userId,companyId,branchId:null,action:'accounting.fixed_asset.create',
    entityType:'fixed_asset',entityId:asset.rows[0].id,oldValues:null,
    newValues:{assetCode,name,cost,residualValue,usefulLifeMonths,acquisitionJournalEntryId:journal.rows[0].id},ipAddress:null,
   });
   return asset.rows[0].id;
  });
  return this.getFixedAsset(user,id);
 }

 async depreciateFixedAsset(user:AuthenticatedUser,id:string,periodEndInput:string) {
  const membership=await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const {companyId}=membership;
  const periodEnd=this.validateDate(periodEndInput,'periodEnd');
  const periodDate=new Date(periodEnd+'T00:00:00.000Z');
  const periodYear=periodDate.getUTCFullYear(),periodMonth=periodDate.getUTCMonth()+1;
  const monthEnd=new Date(Date.UTC(periodYear,periodMonth,0)).toISOString().slice(0,10);
  if(monthEnd!==periodEnd)throw new BadRequestException('Depreciation must be posted at month end.');
  await this.db.transaction(async client=>{
   const assetResult=await client.query<{
    id:string;asset_code:string;name:string;acquisition_date:string;cost:string|number;residual_value:string|number;
    useful_life_months:number;accumulated_depreciation:string|number;asset_account_id:string;
    accumulated_depreciation_account_id:string;depreciation_expense_account_id:string;status:string;
   }>(
    'SELECT id,asset_code,name,acquisition_date,cost,residual_value,useful_life_months,accumulated_depreciation,asset_account_id,accumulated_depreciation_account_id,depreciation_expense_account_id,status FROM fixed_assets WHERE company_id=$1 AND id=$2 FOR UPDATE',
    [companyId,id],
   );
   const asset=assetResult.rows[0];
   if(!asset)throw new NotFoundException('Fixed asset not found.');
   if(asset.status!=='active')throw new ConflictException('Only active fixed assets can be depreciated.');
   const acquisition=new Date(asset.acquisition_date+'T00:00:00.000Z');
   const firstPeriod=new Date(Date.UTC(acquisition.getUTCFullYear(),acquisition.getUTCMonth()+2,0)).toISOString().slice(0,10);
   if(periodEnd<firstPeriod)throw new BadRequestException('The first straight-line depreciation period is the month end after the acquisition month.');
   const latest=await client.query<{period_end:string|null}>(
    'SELECT MAX(period_end)::text AS period_end FROM fixed_asset_depreciation WHERE company_id=$1 AND asset_id=$2',
    [companyId,id],
   );
   const expectedPeriod=latest.rows[0]?.period_end
    ? new Date(Date.UTC(new Date(latest.rows[0].period_end+'T00:00:00.000Z').getUTCFullYear(),new Date(latest.rows[0].period_end+'T00:00:00.000Z').getUTCMonth()+2,0)).toISOString().slice(0,10)
    : firstPeriod;
   if(periodEnd!==expectedPeriod)throw new ConflictException(`Depreciation periods must be posted monthly in order. Next period: ${expectedPeriod}.`);
   const depreciableBase=Math.round((Number(asset.cost)-Number(asset.residual_value))*100)/100;
   const accumulated=Number(asset.accumulated_depreciation);
   const monthly=Math.round((depreciableBase/Number(asset.useful_life_months))*100)/100;
   const amount=Math.round(Math.min(monthly,depreciableBase-accumulated)*100)/100;
   if(amount<=0)throw new ConflictException('This asset has no remaining depreciable value.');
   const year=periodYear;
   const sequence=await client.query<{next_number:number}>(
    `INSERT INTO journal_entry_sequences(company_id,entry_year,next_number) VALUES($1,$2,1)
     ON CONFLICT(company_id,entry_year) DO UPDATE SET next_number=journal_entry_sequences.next_number+1 RETURNING next_number`,
    [companyId,year],
   );
   const entryNumber=`JE-${year}-${String(sequence.rows[0].next_number).padStart(6,'0')}`;
   const journal=await client.query<{id:string}>(
    `INSERT INTO journal_entries(company_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by)
     VALUES($1,$2,$3::date,$4,'fixed_asset_depreciation',NULL,'posted',NOW(),$5) RETURNING id`,
    [companyId,entryNumber,periodEnd,`Monthly depreciation - ${asset.asset_code} - ${asset.name}`,user.userId],
   );
   const depreciation=await client.query<{id:string}>(
    `INSERT INTO fixed_asset_depreciation(company_id,asset_id,period_end,depreciation_amount,journal_entry_id,posted_by)
     VALUES($1,$2,$3::date,$4,$5,$6) RETURNING id`,
    [companyId,id,periodEnd,amount,journal.rows[0].id,user.userId],
   );
   await client.query(
    `INSERT INTO journal_entry_lines(company_id,journal_entry_id,account_id,description,debit,credit)
     VALUES($1,$2,$3,$4,$5,0),($1,$2,$6,$7,0,$5)`,
    [companyId,journal.rows[0].id,asset.depreciation_expense_account_id,`Depreciation expense - ${asset.asset_code}`,amount,asset.accumulated_depreciation_account_id,`Accumulated depreciation - ${asset.asset_code}`],
   );
   const newAccumulated=Math.round((accumulated+amount)*100)/100;
   const fullyDepreciated=newAccumulated>=depreciableBase-0.005;
   await client.query(
    'UPDATE fixed_assets SET accumulated_depreciation=$1,status=$2,updated_at=NOW() WHERE company_id=$3 AND id=$4',
    [fullyDepreciated?depreciableBase:newAccumulated,fullyDepreciated?'fully_depreciated':'active',companyId,id],
   );
   await this.audit.logInTransaction(client,{
    userId:user.userId,companyId,branchId:null,action:'accounting.fixed_asset.depreciate',
    entityType:'fixed_asset',entityId:id,oldValues:{accumulatedDepreciation:accumulated,status:asset.status},
    newValues:{periodEnd,depreciationAmount:amount,journalEntryId:journal.rows[0].id,accumulatedDepreciation:fullyDepreciated?depreciableBase:newAccumulated},ipAddress:null,
   });
  });
  return this.getFixedAsset(user,id);
 }

 async listBankStatements(user: AuthenticatedUser) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  return (await this.db.query(
   `SELECT i.*,a.code AS account_code,a.name AS account_name,
     COUNT(l.id)::int AS line_count,
     COUNT(l.id) FILTER (WHERE l.status='matched')::int AS matched_count,
     COUNT(l.id) FILTER (WHERE l.status='unmatched')::int AS unmatched_count,
     COALESCE(SUM(l.credit-l.debit),0)::numeric(14,2) AS statement_net_movement,
     (i.opening_balance+COALESCE(SUM(l.credit-l.debit),0))::numeric(14,2) AS calculated_closing_balance,
     (i.closing_balance-(i.opening_balance+COALESCE(SUM(l.credit-l.debit),0)))::numeric(14,2) AS closing_variance
    FROM bank_statement_imports i
    JOIN chart_of_accounts a ON a.id=i.bank_account_id AND a.company_id=i.company_id
    LEFT JOIN bank_statement_lines l ON l.statement_import_id=i.id AND l.company_id=i.company_id
    WHERE i.company_id=$1
    GROUP BY i.id,a.code,a.name
    ORDER BY i.statement_end DESC,i.created_at DESC`,
   [companyId],
  )).rows;
 }

 async importBankStatement(user: AuthenticatedUser, dto: CreateBankStatementDto) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  const statementStart = this.validateDate(dto.statementStart, 'statementStart');
  const statementEnd = this.validateDate(dto.statementEnd, 'statementEnd');
  if (statementStart > statementEnd) throw new BadRequestException('Statement end must be on or after statement start.');
  if (!Array.isArray(dto.lines) || dto.lines.length < 1) throw new BadRequestException('A statement import requires at least one transaction line.');
  const openingBalance = Math.round(Number(dto.openingBalance) * 100) / 100;
  const closingBalance = Math.round(Number(dto.closingBalance) * 100) / 100;
  if (!Number.isFinite(openingBalance) || !Number.isFinite(closingBalance)) throw new BadRequestException('Statement balances must be valid amounts.');
  const lines = dto.lines.map((line,index) => {
   const transactionDate = this.validateDate(line.transactionDate, `lines[${index}].transactionDate`);
   if (transactionDate < statementStart || transactionDate > statementEnd) throw new BadRequestException(`Statement line ${index+1} falls outside the statement period.`);
   const debit = Math.round(Number(line.debit ?? 0) * 100) / 100;
   const credit = Math.round(Number(line.credit ?? 0) * 100) / 100;
   if (!line.description.trim() || !Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0 || (debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
    throw new BadRequestException(`Statement line ${index+1} must have a description and exactly one positive debit or credit amount.`);
   }
   const runningBalance = line.runningBalance == null ? null : Math.round(Number(line.runningBalance)*100)/100;
   if (runningBalance != null && !Number.isFinite(runningBalance)) throw new BadRequestException(`Statement line ${index+1} has an invalid running balance.`);
   return { transactionDate, description: line.description.trim(), reference: line.reference?.trim() || null, debit, credit, runningBalance };
  });
  const id = await this.db.transaction(async client => {
   const account = await client.query<{ id:string; system_code:string|null }>(
    `SELECT id,system_code FROM chart_of_accounts WHERE company_id=$1 AND id=$2 AND is_active=true AND system_code IN ('bank','mpesa') FOR SHARE`,
    [companyId,dto.accountId],
   );
   if (!account.rows[0]) throw new BadRequestException('Select an active company bank or M-Pesa ledger account.');
   const inserted = await client.query<{id:string}>(
    `INSERT INTO bank_statement_imports(company_id,bank_account_id,statement_start,statement_end,opening_balance,closing_balance,file_name,created_by)
     VALUES($1,$2,$3::date,$4::date,$5,$6,$7,$8) RETURNING id`,
    [companyId,dto.accountId,statementStart,statementEnd,openingBalance,closingBalance,dto.fileName?.trim()||null,user.userId],
   );
   for (const line of lines) {
    await client.query(
     `INSERT INTO bank_statement_lines(company_id,statement_import_id,bank_account_id,transaction_date,description,reference,debit,credit,running_balance)
      VALUES($1,$2,$3,$4::date,$5,$6,$7,$8,$9)`,
     [companyId,inserted.rows[0].id,dto.accountId,line.transactionDate,line.description,line.reference,line.debit,line.credit,line.runningBalance],
    );
   }
   await this.audit.logInTransaction(client,{
    userId:user.userId,companyId,branchId:null,action:'accounting.bank_statement.import',
    entityType:'bank_statement_import',entityId:inserted.rows[0].id,oldValues:null,
    newValues:{accountId:dto.accountId,statementStart,statementEnd,lineCount:lines.length,fileName:dto.fileName??null},ipAddress:null,
   });
   return inserted.rows[0].id;
  });
  return this.getBankStatementImport(user,id);
 }

 async getBankStatementImport(user: AuthenticatedUser, id: string) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  const result = await this.db.query(
   `SELECT i.*,a.code AS account_code,a.name AS account_name
    FROM bank_statement_imports i JOIN chart_of_accounts a ON a.id=i.bank_account_id AND a.company_id=i.company_id
    WHERE i.company_id=$1 AND i.id=$2`,
   [companyId,id],
  );
  if (!result.rows[0]) throw new NotFoundException('Bank statement import not found.');
  const lines = await this.db.query(
   `SELECT l.*,j.entry_number AS matched_entry_number,j.entry_date AS matched_entry_date,j.description AS matched_entry_description
    FROM bank_statement_lines l
    LEFT JOIN journal_entries j ON j.id=l.matched_journal_entry_id AND j.company_id=l.company_id
    WHERE l.company_id=$1 AND l.statement_import_id=$2
    ORDER BY l.transaction_date,l.created_at,l.id`,
   [companyId,id],
  );
  const header = result.rows[0] as Record<string,unknown>;
  const lineRows = lines.rows as Array<Record<string,unknown>>;
  const statementNetMovement = lineRows.reduce((sum,line)=>sum+Number(line.credit)-Number(line.debit),0);
  const calculatedClosingBalance = Number(header.opening_balance)+statementNetMovement;
  return {
   ...header, lines:lineRows,
   lineCount:lineRows.length,
   matchedCount:lineRows.filter(line=>line.status==='matched').length,
   unmatchedCount:lineRows.filter(line=>line.status==='unmatched').length,
   statementNetMovement:Math.round(statementNetMovement*100)/100,
   calculatedClosingBalance:Math.round(calculatedClosingBalance*100)/100,
   closingVariance:Math.round((Number(header.closing_balance)-calculatedClosingBalance)*100)/100,
  };
 }

 async bankStatementCandidates(user: AuthenticatedUser, importId: string, lineId: string) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  const line = await this.db.query<{bank_account_id:string;transaction_date:string;debit:string|number;credit:string|number;status:string}>(
   `SELECT bank_account_id,transaction_date,debit,credit,status FROM bank_statement_lines
    WHERE company_id=$1 AND statement_import_id=$2 AND id=$3`,
   [companyId,importId,lineId],
  );
  if (!line.rows[0]) throw new NotFoundException('Statement line not found.');
  if (line.rows[0].status==='matched') throw new ConflictException('This statement line is already matched.');
  const statementNet = Number(line.rows[0].credit)-Number(line.rows[0].debit);
  return (await this.db.query(
   `SELECT j.id,j.entry_number,j.entry_date,j.description,
      SUM(l.debit-l.credit)::numeric(14,2) AS bank_movement
    FROM journal_entries j
    JOIN journal_entry_lines l ON l.journal_entry_id=j.id AND l.company_id=j.company_id
      AND l.account_id=$2
    WHERE j.company_id=$1 AND j.status='posted'
      AND j.entry_date BETWEEN $3::date-INTERVAL '7 days' AND $3::date+INTERVAL '7 days'
      AND NOT EXISTS (
       SELECT 1 FROM bank_statement_lines matched
       WHERE matched.company_id=$1 AND matched.bank_account_id=$2 AND matched.matched_journal_entry_id=j.id
      )
    GROUP BY j.id
    HAVING ABS(SUM(l.debit-l.credit)-$4::numeric)<=0.01
    ORDER BY ABS(j.entry_date-$3::date),j.entry_date DESC
    LIMIT 25`,
   [companyId,line.rows[0].bank_account_id,line.rows[0].transaction_date,statementNet],
  )).rows;
 }

 async unmatchBankStatementLine(user: AuthenticatedUser, importId: string, lineId: string) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  await this.db.transaction(async client => {
   const line = await client.query<{id:string;status:string;matched_journal_entry_id:string|null}>(
    'SELECT id,status,matched_journal_entry_id FROM bank_statement_lines WHERE company_id=$1 AND statement_import_id=$2 AND id=$3 FOR UPDATE',
    [companyId,importId,lineId],
   );
   if(!line.rows[0])throw new NotFoundException('Statement line not found.');
   if(line.rows[0].status!=='matched')throw new ConflictException('Only a matched statement line can be unmatched.');
   await client.query(
    `UPDATE bank_statement_lines SET status='unmatched',matched_journal_entry_id=NULL,matched_by=NULL,matched_at=NULL
     WHERE company_id=$1 AND statement_import_id=$2 AND id=$3`,
    [companyId,importId,lineId],
   );
   await client.query(
    `UPDATE bank_statement_imports SET status='imported',reconciled_at=NULL WHERE company_id=$1 AND id=$2`,
    [companyId,importId],
   );
   await this.audit.logInTransaction(client,{
    userId:user.userId,companyId,branchId:null,action:'accounting.bank_statement.unmatch',
    entityType:'bank_statement_line',entityId:lineId,
    oldValues:{status:'matched',journalEntryId:line.rows[0].matched_journal_entry_id},
    newValues:{status:'unmatched'},ipAddress:null,
   });
  });
  return this.getBankStatementImport(user,importId);
 }

 async matchBankStatementLine(user: AuthenticatedUser, importId: string, lineId: string, journalEntryId: string) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  await this.db.transaction(async client => {
   const lineResult = await client.query<{
    id:string;bank_account_id:string;transaction_date:string;debit:string|number;credit:string|number;status:string;
   }>(
    `SELECT id,bank_account_id,transaction_date,debit,credit,status FROM bank_statement_lines
     WHERE company_id=$1 AND statement_import_id=$2 AND id=$3 FOR UPDATE`,
    [companyId,importId,lineId],
   );
   const line=lineResult.rows[0];
   if(!line)throw new NotFoundException('Statement line not found.');
   if(line.status==='matched')throw new ConflictException('This statement line is already matched.');
   const journalLock=await client.query<{id:string}>(
    'SELECT id FROM journal_entries WHERE company_id=$1 AND id=$2 AND status=\'posted\' FOR SHARE',
    [companyId,journalEntryId],
   );
   if(!journalLock.rows[0])throw new BadRequestException('The selected journal entry is not posted or does not belong to this company.');
   const journal=await client.query<{id:string}>(
    `SELECT j.id FROM journal_entries j
     JOIN journal_entry_lines l ON l.journal_entry_id=j.id AND l.company_id=j.company_id AND l.account_id=$3
     WHERE j.company_id=$1 AND j.id=$2 AND j.status='posted'
       AND j.entry_date BETWEEN $4::date-INTERVAL '7 days' AND $4::date+INTERVAL '7 days'
     GROUP BY j.id
     HAVING ABS(SUM(l.debit-l.credit)-$5::numeric)<=0.01`,
    [companyId,journalEntryId,line.bank_account_id,line.transaction_date,Number(line.credit)-Number(line.debit)],
   );
   if(!journal.rows[0])throw new BadRequestException('The selected journal does not match this bank account, date window and statement amount.');
   await client.query(
    `UPDATE bank_statement_lines SET status='matched',matched_journal_entry_id=$1,matched_by=$2,matched_at=NOW()
     WHERE company_id=$3 AND statement_import_id=$4 AND id=$5 AND status='unmatched'`,
    [journalEntryId,user.userId,companyId,importId,lineId],
   );
   await client.query(
    `UPDATE bank_statement_imports i SET status=CASE
      WHEN NOT EXISTS(SELECT 1 FROM bank_statement_lines l WHERE l.company_id=i.company_id AND l.statement_import_id=i.id AND l.status='unmatched')
       AND ABS(i.closing_balance-(i.opening_balance+COALESCE((SELECT SUM(l.credit-l.debit) FROM bank_statement_lines l WHERE l.company_id=i.company_id AND l.statement_import_id=i.id),0)))<=0.01
      THEN 'reconciled' ELSE 'imported' END,
      reconciled_at=CASE
       WHEN NOT EXISTS(SELECT 1 FROM bank_statement_lines l WHERE l.company_id=i.company_id AND l.statement_import_id=i.id AND l.status='unmatched')
        AND ABS(i.closing_balance-(i.opening_balance+COALESCE((SELECT SUM(l.credit-l.debit) FROM bank_statement_lines l WHERE l.company_id=i.company_id AND l.statement_import_id=i.id),0)))<=0.01
       THEN NOW() ELSE NULL END
     WHERE i.company_id=$1 AND i.id=$2`,
    [companyId,importId],
   );
   await this.audit.logInTransaction(client,{
    userId:user.userId,companyId,branchId:null,action:'accounting.bank_statement.match',
    entityType:'bank_statement_line',entityId:lineId,oldValues:{status:'unmatched'},
    newValues:{status:'matched',journalEntryId},ipAddress:null,
   });
  });
  return this.getBankStatementImport(user,importId);
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

 async withholdingTaxSchedule(user: AuthenticatedUser, startDate: string, endDate: string) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  this.validateDate(startDate, 'startDate');
  this.validateDate(endDate, 'endDate');
  if (startDate > endDate) throw new BadRequestException('startDate must be on or before endDate.');
  const currency = await this.getCompanyCurrency(companyId);
  const result = await this.db.query<{
   payment_date: string; supplier_name: string; kra_pin: string|null; bill_number: string;
   supplier_invoice_number: string|null; amount: string|number; cash_amount: string|number;
   withholding_tax_amount: string|number; withholding_certificate_number: string|null; reference: string|null;
  }>(
   `SELECT p.payment_date,s.name AS supplier_name,s.kra_pin,b.bill_number,b.supplier_invoice_number,
      p.amount,p.cash_amount,p.withholding_tax_amount,p.withholding_certificate_number,p.reference
    FROM supplier_bill_payments p
    JOIN supplier_bills b ON b.id=p.supplier_bill_id AND b.company_id=p.company_id
    JOIN suppliers s ON s.id=b.supplier_id AND s.company_id=b.company_id
    WHERE p.company_id=$1 AND p.payment_date>=$2::date AND p.payment_date<=$3::date
      AND p.withholding_tax_amount>0
    ORDER BY p.payment_date,s.name,b.bill_number`,
   [companyId, startDate, endDate],
  );
  const payments = result.rows.map(row => ({
   ...row, amount: Number(row.amount), cash_amount: Number(row.cash_amount),
   withholding_tax_amount: Number(row.withholding_tax_amount),
  }));
  return {
   companyId, currency, startDate, endDate, payments,
   totalGrossPayments: payments.reduce((sum,row)=>sum+row.amount,0),
   totalCashPaid: payments.reduce((sum,row)=>sum+row.cash_amount,0),
   totalWithholdingTax: payments.reduce((sum,row)=>sum+row.withholding_tax_amount,0),
  };
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

  const [accounts, earnings] = await Promise.all([
   this.db.query<{
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
    [companyId, asOfDate]),
   this.db.query<{ current_earnings: string | number }>(
    `SELECT COALESCE(SUM(CASE WHEN a.account_type='income' THEN l.credit-l.debit ELSE l.debit-l.credit END),0)::numeric(14,2) AS current_earnings
     FROM chart_of_accounts a
     JOIN journal_entry_lines l ON l.account_id=a.id AND l.company_id=a.company_id
     JOIN journal_entries j ON j.id=l.journal_entry_id AND j.company_id=l.company_id
     WHERE a.company_id=$1 AND a.account_type IN ('income','expense') AND j.status='posted' AND j.entry_date<=$2::date`,
    [companyId, asOfDate]),
  ]);

  const rows = accounts.rows.map(r => ({ ...r, balance: Number(r.balance) }));
  const assetAccounts = rows.filter(a => a.account_type === 'asset');
  const liabilityAccounts = rows.filter(a => a.account_type === 'liability');
  const equityAccounts = rows.filter(a => a.account_type === 'equity');
  const currentEarnings = Number(earnings.rows[0]?.current_earnings ?? 0);
  if (Math.abs(currentEarnings) > 0.005) {
   equityAccounts.push({
    id: 'calculated-current-earnings', code: '—', name: 'Current / retained earnings',
    account_type: 'equity', system_code: 'calculated_retained_earnings', balance: currentEarnings,
   });
  }

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
  const categories = await this.db.query<{ category: 'operating'|'investing'|'financing'; amount: string|number }>(
   `WITH cash_entries AS (
     SELECT j.id
     FROM journal_entries j
     JOIN journal_entry_lines cash_line ON cash_line.journal_entry_id=j.id AND cash_line.company_id=j.company_id
     JOIN chart_of_accounts cash_account ON cash_account.id=cash_line.account_id AND cash_account.company_id=j.company_id
     WHERE j.company_id=$1 AND j.status='posted' AND j.entry_date>=$2::date AND j.entry_date<=$3::date
       AND cash_account.system_code IN ('cash','bank','mpesa')
     GROUP BY j.id
     HAVING ABS(SUM(cash_line.debit-cash_line.credit))>0.005
    ), counterpart_movements AS (
     SELECT
      CASE
       WHEN account.cash_flow_category IS NOT NULL THEN account.cash_flow_category
       WHEN account.system_code IN ('accounts_receivable','accounts_payable','inventory','input_tax','output_tax','goods_received_not_invoiced','customer_credits','withholding_tax_payable') THEN 'operating'
       WHEN account.account_type IN ('income','expense') THEN 'operating'
       WHEN account.account_type='equity' THEN 'financing'
       WHEN account.account_type IN ('asset','liability') THEN NULL
       ELSE 'operating'
      END AS category,
      SUM(line.credit-line.debit) AS amount
     FROM cash_entries ce
     JOIN journal_entries j ON j.id=ce.id AND j.company_id=$1
     JOIN journal_entry_lines line ON line.journal_entry_id=j.id AND line.company_id=j.company_id
     JOIN chart_of_accounts account ON account.id=line.account_id AND account.company_id=line.company_id
     WHERE account.system_code IS NULL OR account.system_code NOT IN ('cash','bank','mpesa')
     GROUP BY 1
    )
    SELECT category,COALESCE(SUM(amount),0)::numeric(14,2) AS amount
    FROM counterpart_movements GROUP BY category ORDER BY category`,
   [companyId, startDate, endDate],
  );
  const cashFlowCategories = (['operating','investing','financing'] as const).map(category => ({
   category, amount: Number(categories.rows.find(row => row.category === category)?.amount ?? 0),
  }));
  const classifiedMovement = cashFlowCategories.reduce((sum, item) => sum + item.amount, 0);
  const classificationVariance = Math.round((netCashMovement - classifiedMovement) * 100) / 100;

  return {
   currency, startDate, endDate, cashAccounts, cashFlowCategories,
   totalOpeningBalance: totalOpening,
   totalClosingBalance: totalClosing,
   netCashMovement,
   classificationVariance,
   method: 'direct',
  };
 }
}
+params.length;}
  if(periodMonth!==undefined){params.push(periodMonth);filter+=' AND b.period_month=
  const membership=await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  return (await this.db.query(
   `SELECT f.*,asset_account.code AS asset_account_code,asset_account.name AS asset_account_name,
      accumulated_account.name AS accumulated_depreciation_account_name,
      expense_account.name AS depreciation_expense_account_name,payment_account.name AS payment_account_name,
      (f.cost-f.accumulated_depreciation)::numeric(14,2) AS net_book_value
    FROM fixed_assets f
    JOIN chart_of_accounts asset_account ON asset_account.id=f.asset_account_id AND asset_account.company_id=f.company_id
    JOIN chart_of_accounts accumulated_account ON accumulated_account.id=f.accumulated_depreciation_account_id AND accumulated_account.company_id=f.company_id
    JOIN chart_of_accounts expense_account ON expense_account.id=f.depreciation_expense_account_id AND expense_account.company_id=f.company_id
    JOIN chart_of_accounts payment_account ON payment_account.id=f.payment_account_id AND payment_account.company_id=f.company_id
    WHERE f.company_id=$1 ORDER BY f.status,f.asset_code`,
   [membership.companyId],
  )).rows;
 }

 async getFixedAsset(user: AuthenticatedUser,id:string) {
  const membership=await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const header=await this.db.query(
   `SELECT f.*,asset_account.code AS asset_account_code,asset_account.name AS asset_account_name,
      accumulated_account.name AS accumulated_depreciation_account_name,
      expense_account.name AS depreciation_expense_account_name,payment_account.name AS payment_account_name,
      (f.cost-f.accumulated_depreciation)::numeric(14,2) AS net_book_value
    FROM fixed_assets f
    JOIN chart_of_accounts asset_account ON asset_account.id=f.asset_account_id AND asset_account.company_id=f.company_id
    JOIN chart_of_accounts accumulated_account ON accumulated_account.id=f.accumulated_depreciation_account_id AND accumulated_account.company_id=f.company_id
    JOIN chart_of_accounts expense_account ON expense_account.id=f.depreciation_expense_account_id AND expense_account.company_id=f.company_id
    JOIN chart_of_accounts payment_account ON payment_account.id=f.payment_account_id AND payment_account.company_id=f.company_id
    WHERE f.company_id=$1 AND f.id=$2`,
   [membership.companyId,id],
  );
  if(!header.rows[0])throw new NotFoundException('Fixed asset not found.');
  const schedule=await this.db.query(
   `SELECT d.*,j.entry_number FROM fixed_asset_depreciation d
    JOIN journal_entries j ON j.id=d.journal_entry_id AND j.company_id=d.company_id
    WHERE d.company_id=$1 AND d.asset_id=$2 ORDER BY d.period_end`,
   [membership.companyId,id],
  );
  return {...header.rows[0],depreciationSchedule:schedule.rows};
 }

 async createFixedAsset(user:AuthenticatedUser,dto:CreateFixedAssetDto) {
  const membership=await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const {companyId}=membership;
  const acquisitionDate=this.validateDate(dto.acquisitionDate,'acquisitionDate');
  const cost=Math.round(Number(dto.cost)*100)/100;
  const residualValue=Math.round(Number(dto.residualValue??0)*100)/100;
  const usefulLifeMonths=Number(dto.usefulLifeMonths);
  if(!Number.isFinite(cost)||cost<=0||!Number.isFinite(residualValue)||residualValue<0||residualValue>cost||!Number.isInteger(usefulLifeMonths)||usefulLifeMonths<1)throw new BadRequestException('Enter a positive asset cost, a valid residual value and a whole-number useful life in months.');
  const assetCode=dto.assetCode.trim();
  const name=dto.name.trim();
  if(!assetCode||!name)throw new BadRequestException('Asset code and name are required.');
  const id=await this.db.transaction(async client=>{
   await this.ensureDefaults(companyId,client);
   const accountIds=[dto.assetAccountId,dto.accumulatedDepreciationAccountId,dto.depreciationExpenseAccountId,dto.paymentAccountId];
   if(new Set(accountIds).size!==4)throw new BadRequestException('Select four distinct ledger accounts for the asset.');
   const accounts=await client.query<{id:string;account_type:string;normal_side:string;system_code:string|null}>(
    'SELECT id,account_type,normal_side,system_code FROM chart_of_accounts WHERE company_id=$1 AND id=ANY($2::uuid[]) AND is_active=true FOR SHARE',
    [companyId,accountIds],
   );
   if(accounts.rows.length!==4)throw new BadRequestException('All fixed asset ledger accounts must be active and belong to this company.');
   const byId=new Map(accounts.rows.map(a=>[a.id,a]));
   if(byId.get(dto.assetAccountId)?.account_type!=='asset')throw new BadRequestException('The fixed asset account must be an asset account.');
   if(byId.get(dto.accumulatedDepreciationAccountId)?.account_type!=='asset'||byId.get(dto.accumulatedDepreciationAccountId)?.normal_side!=='credit')throw new BadRequestException('Accumulated depreciation must use a credit-normal asset account.');
   if(byId.get(dto.depreciationExpenseAccountId)?.account_type!=='expense')throw new BadRequestException('Depreciation must use an expense account.');
   const paymentAccount=byId.get(dto.paymentAccountId);
   if(paymentAccount?.account_type!=='asset'||!['cash','bank','mpesa'].includes(paymentAccount.system_code??''))throw new BadRequestException('Select an active cash, bank or M-Pesa ledger account for the acquisition payment.');
   const asset=await client.query<{id:string}>(
    `INSERT INTO fixed_assets(company_id,asset_code,name,description,acquisition_date,cost,residual_value,useful_life_months,
      asset_account_id,accumulated_depreciation_account_id,depreciation_expense_account_id,payment_account_id,created_by)
     VALUES($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [companyId,assetCode,name,dto.description?.trim()||null,acquisitionDate,cost,residualValue,usefulLifeMonths,
     dto.assetAccountId,dto.accumulatedDepreciationAccountId,dto.depreciationExpenseAccountId,dto.paymentAccountId,user.userId],
   );
   const year=Number(acquisitionDate.slice(0,4));
   const sequence=await client.query<{next_number:number}>(
    `INSERT INTO journal_entry_sequences(company_id,entry_year,next_number) VALUES($1,$2,1)
     ON CONFLICT(company_id,entry_year) DO UPDATE SET next_number=journal_entry_sequences.next_number+1 RETURNING next_number`,
    [companyId,year],
   );
   const entryNumber=`JE-${year}-${String(sequence.rows[0].next_number).padStart(6,'0')}`;
   const journal=await client.query<{id:string}>(
    `INSERT INTO journal_entries(company_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by)
     VALUES($1,$2,$3::date,$4,'fixed_asset_acquisition',$5,'posted',NOW(),$6) RETURNING id`,
    [companyId,entryNumber,acquisitionDate,`Acquire fixed asset ${assetCode} - ${name}`,asset.rows[0].id,user.userId],
   );
   await client.query(
    `INSERT INTO journal_entry_lines(company_id,journal_entry_id,account_id,description,debit,credit)
     VALUES($1,$2,$3,$4,$5,0),($1,$2,$6,$7,0,$5)`,
    [companyId,journal.rows[0].id,dto.assetAccountId,`Capitalise asset ${assetCode}`,cost,dto.paymentAccountId,`Cash/bank payment for asset ${assetCode}`],
   );
   await client.query('UPDATE fixed_assets SET acquisition_journal_entry_id=$1 WHERE company_id=$2 AND id=$3',[journal.rows[0].id,companyId,asset.rows[0].id]);
   await this.audit.logInTransaction(client,{
    userId:user.userId,companyId,branchId:null,action:'accounting.fixed_asset.create',
    entityType:'fixed_asset',entityId:asset.rows[0].id,oldValues:null,
    newValues:{assetCode,name,cost,residualValue,usefulLifeMonths,acquisitionJournalEntryId:journal.rows[0].id},ipAddress:null,
   });
   return asset.rows[0].id;
  });
  return this.getFixedAsset(user,id);
 }

 async depreciateFixedAsset(user:AuthenticatedUser,id:string,periodEndInput:string) {
  const membership=await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const {companyId}=membership;
  const periodEnd=this.validateDate(periodEndInput,'periodEnd');
  const periodDate=new Date(periodEnd+'T00:00:00.000Z');
  const periodYear=periodDate.getUTCFullYear(),periodMonth=periodDate.getUTCMonth()+1;
  const monthEnd=new Date(Date.UTC(periodYear,periodMonth,0)).toISOString().slice(0,10);
  if(monthEnd!==periodEnd)throw new BadRequestException('Depreciation must be posted at month end.');
  await this.db.transaction(async client=>{
   const assetResult=await client.query<{
    id:string;asset_code:string;name:string;acquisition_date:string;cost:string|number;residual_value:string|number;
    useful_life_months:number;accumulated_depreciation:string|number;asset_account_id:string;
    accumulated_depreciation_account_id:string;depreciation_expense_account_id:string;status:string;
   }>(
    'SELECT id,asset_code,name,acquisition_date,cost,residual_value,useful_life_months,accumulated_depreciation,asset_account_id,accumulated_depreciation_account_id,depreciation_expense_account_id,status FROM fixed_assets WHERE company_id=$1 AND id=$2 FOR UPDATE',
    [companyId,id],
   );
   const asset=assetResult.rows[0];
   if(!asset)throw new NotFoundException('Fixed asset not found.');
   if(asset.status!=='active')throw new ConflictException('Only active fixed assets can be depreciated.');
   const acquisition=new Date(asset.acquisition_date+'T00:00:00.000Z');
   const firstPeriod=new Date(Date.UTC(acquisition.getUTCFullYear(),acquisition.getUTCMonth()+2,0)).toISOString().slice(0,10);
   if(periodEnd<firstPeriod)throw new BadRequestException('The first straight-line depreciation period is the month end after the acquisition month.');
   const latest=await client.query<{period_end:string|null}>(
    'SELECT MAX(period_end)::text AS period_end FROM fixed_asset_depreciation WHERE company_id=$1 AND asset_id=$2',
    [companyId,id],
   );
   const expectedPeriod=latest.rows[0]?.period_end
    ? new Date(Date.UTC(new Date(latest.rows[0].period_end+'T00:00:00.000Z').getUTCFullYear(),new Date(latest.rows[0].period_end+'T00:00:00.000Z').getUTCMonth()+2,0)).toISOString().slice(0,10)
    : firstPeriod;
   if(periodEnd!==expectedPeriod)throw new ConflictException(`Depreciation periods must be posted monthly in order. Next period: ${expectedPeriod}.`);
   const depreciableBase=Math.round((Number(asset.cost)-Number(asset.residual_value))*100)/100;
   const accumulated=Number(asset.accumulated_depreciation);
   const monthly=Math.round((depreciableBase/Number(asset.useful_life_months))*100)/100;
   const amount=Math.round(Math.min(monthly,depreciableBase-accumulated)*100)/100;
   if(amount<=0)throw new ConflictException('This asset has no remaining depreciable value.');
   const year=periodYear;
   const sequence=await client.query<{next_number:number}>(
    `INSERT INTO journal_entry_sequences(company_id,entry_year,next_number) VALUES($1,$2,1)
     ON CONFLICT(company_id,entry_year) DO UPDATE SET next_number=journal_entry_sequences.next_number+1 RETURNING next_number`,
    [companyId,year],
   );
   const entryNumber=`JE-${year}-${String(sequence.rows[0].next_number).padStart(6,'0')}`;
   const journal=await client.query<{id:string}>(
    `INSERT INTO journal_entries(company_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by)
     VALUES($1,$2,$3::date,$4,'fixed_asset_depreciation',NULL,'posted',NOW(),$5) RETURNING id`,
    [companyId,entryNumber,periodEnd,`Monthly depreciation - ${asset.asset_code} - ${asset.name}`,user.userId],
   );
   const depreciation=await client.query<{id:string}>(
    `INSERT INTO fixed_asset_depreciation(company_id,asset_id,period_end,depreciation_amount,journal_entry_id,posted_by)
     VALUES($1,$2,$3::date,$4,$5,$6) RETURNING id`,
    [companyId,id,periodEnd,amount,journal.rows[0].id,user.userId],
   );
   await client.query(
    `INSERT INTO journal_entry_lines(company_id,journal_entry_id,account_id,description,debit,credit)
     VALUES($1,$2,$3,$4,$5,0),($1,$2,$6,$7,0,$5)`,
    [companyId,journal.rows[0].id,asset.depreciation_expense_account_id,`Depreciation expense - ${asset.asset_code}`,amount,asset.accumulated_depreciation_account_id,`Accumulated depreciation - ${asset.asset_code}`],
   );
   const newAccumulated=Math.round((accumulated+amount)*100)/100;
   const fullyDepreciated=newAccumulated>=depreciableBase-0.005;
   await client.query(
    'UPDATE fixed_assets SET accumulated_depreciation=$1,status=$2,updated_at=NOW() WHERE company_id=$3 AND id=$4',
    [fullyDepreciated?depreciableBase:newAccumulated,fullyDepreciated?'fully_depreciated':'active',companyId,id],
   );
   await this.audit.logInTransaction(client,{
    userId:user.userId,companyId,branchId:null,action:'accounting.fixed_asset.depreciate',
    entityType:'fixed_asset',entityId:id,oldValues:{accumulatedDepreciation:accumulated,status:asset.status},
    newValues:{periodEnd,depreciationAmount:amount,journalEntryId:journal.rows[0].id,accumulatedDepreciation:fullyDepreciated?depreciableBase:newAccumulated},ipAddress:null,
   });
  });
  return this.getFixedAsset(user,id);
 }

 async listBankStatements(user: AuthenticatedUser) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  return (await this.db.query(
   `SELECT i.*,a.code AS account_code,a.name AS account_name,
     COUNT(l.id)::int AS line_count,
     COUNT(l.id) FILTER (WHERE l.status='matched')::int AS matched_count,
     COUNT(l.id) FILTER (WHERE l.status='unmatched')::int AS unmatched_count,
     COALESCE(SUM(l.credit-l.debit),0)::numeric(14,2) AS statement_net_movement,
     (i.opening_balance+COALESCE(SUM(l.credit-l.debit),0))::numeric(14,2) AS calculated_closing_balance,
     (i.closing_balance-(i.opening_balance+COALESCE(SUM(l.credit-l.debit),0)))::numeric(14,2) AS closing_variance
    FROM bank_statement_imports i
    JOIN chart_of_accounts a ON a.id=i.bank_account_id AND a.company_id=i.company_id
    LEFT JOIN bank_statement_lines l ON l.statement_import_id=i.id AND l.company_id=i.company_id
    WHERE i.company_id=$1
    GROUP BY i.id,a.code,a.name
    ORDER BY i.statement_end DESC,i.created_at DESC`,
   [companyId],
  )).rows;
 }

 async importBankStatement(user: AuthenticatedUser, dto: CreateBankStatementDto) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  const statementStart = this.validateDate(dto.statementStart, 'statementStart');
  const statementEnd = this.validateDate(dto.statementEnd, 'statementEnd');
  if (statementStart > statementEnd) throw new BadRequestException('Statement end must be on or after statement start.');
  if (!Array.isArray(dto.lines) || dto.lines.length < 1) throw new BadRequestException('A statement import requires at least one transaction line.');
  const openingBalance = Math.round(Number(dto.openingBalance) * 100) / 100;
  const closingBalance = Math.round(Number(dto.closingBalance) * 100) / 100;
  if (!Number.isFinite(openingBalance) || !Number.isFinite(closingBalance)) throw new BadRequestException('Statement balances must be valid amounts.');
  const lines = dto.lines.map((line,index) => {
   const transactionDate = this.validateDate(line.transactionDate, `lines[${index}].transactionDate`);
   if (transactionDate < statementStart || transactionDate > statementEnd) throw new BadRequestException(`Statement line ${index+1} falls outside the statement period.`);
   const debit = Math.round(Number(line.debit ?? 0) * 100) / 100;
   const credit = Math.round(Number(line.credit ?? 0) * 100) / 100;
   if (!line.description.trim() || !Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0 || (debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
    throw new BadRequestException(`Statement line ${index+1} must have a description and exactly one positive debit or credit amount.`);
   }
   const runningBalance = line.runningBalance == null ? null : Math.round(Number(line.runningBalance)*100)/100;
   if (runningBalance != null && !Number.isFinite(runningBalance)) throw new BadRequestException(`Statement line ${index+1} has an invalid running balance.`);
   return { transactionDate, description: line.description.trim(), reference: line.reference?.trim() || null, debit, credit, runningBalance };
  });
  const id = await this.db.transaction(async client => {
   const account = await client.query<{ id:string; system_code:string|null }>(
    `SELECT id,system_code FROM chart_of_accounts WHERE company_id=$1 AND id=$2 AND is_active=true AND system_code IN ('bank','mpesa') FOR SHARE`,
    [companyId,dto.accountId],
   );
   if (!account.rows[0]) throw new BadRequestException('Select an active company bank or M-Pesa ledger account.');
   const inserted = await client.query<{id:string}>(
    `INSERT INTO bank_statement_imports(company_id,bank_account_id,statement_start,statement_end,opening_balance,closing_balance,file_name,created_by)
     VALUES($1,$2,$3::date,$4::date,$5,$6,$7,$8) RETURNING id`,
    [companyId,dto.accountId,statementStart,statementEnd,openingBalance,closingBalance,dto.fileName?.trim()||null,user.userId],
   );
   for (const line of lines) {
    await client.query(
     `INSERT INTO bank_statement_lines(company_id,statement_import_id,bank_account_id,transaction_date,description,reference,debit,credit,running_balance)
      VALUES($1,$2,$3,$4::date,$5,$6,$7,$8,$9)`,
     [companyId,inserted.rows[0].id,dto.accountId,line.transactionDate,line.description,line.reference,line.debit,line.credit,line.runningBalance],
    );
   }
   await this.audit.logInTransaction(client,{
    userId:user.userId,companyId,branchId:null,action:'accounting.bank_statement.import',
    entityType:'bank_statement_import',entityId:inserted.rows[0].id,oldValues:null,
    newValues:{accountId:dto.accountId,statementStart,statementEnd,lineCount:lines.length,fileName:dto.fileName??null},ipAddress:null,
   });
   return inserted.rows[0].id;
  });
  return this.getBankStatementImport(user,id);
 }

 async getBankStatementImport(user: AuthenticatedUser, id: string) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  const result = await this.db.query(
   `SELECT i.*,a.code AS account_code,a.name AS account_name
    FROM bank_statement_imports i JOIN chart_of_accounts a ON a.id=i.bank_account_id AND a.company_id=i.company_id
    WHERE i.company_id=$1 AND i.id=$2`,
   [companyId,id],
  );
  if (!result.rows[0]) throw new NotFoundException('Bank statement import not found.');
  const lines = await this.db.query(
   `SELECT l.*,j.entry_number AS matched_entry_number,j.entry_date AS matched_entry_date,j.description AS matched_entry_description
    FROM bank_statement_lines l
    LEFT JOIN journal_entries j ON j.id=l.matched_journal_entry_id AND j.company_id=l.company_id
    WHERE l.company_id=$1 AND l.statement_import_id=$2
    ORDER BY l.transaction_date,l.created_at,l.id`,
   [companyId,id],
  );
  const header = result.rows[0] as Record<string,unknown>;
  const lineRows = lines.rows as Array<Record<string,unknown>>;
  const statementNetMovement = lineRows.reduce((sum,line)=>sum+Number(line.credit)-Number(line.debit),0);
  const calculatedClosingBalance = Number(header.opening_balance)+statementNetMovement;
  return {
   ...header, lines:lineRows,
   lineCount:lineRows.length,
   matchedCount:lineRows.filter(line=>line.status==='matched').length,
   unmatchedCount:lineRows.filter(line=>line.status==='unmatched').length,
   statementNetMovement:Math.round(statementNetMovement*100)/100,
   calculatedClosingBalance:Math.round(calculatedClosingBalance*100)/100,
   closingVariance:Math.round((Number(header.closing_balance)-calculatedClosingBalance)*100)/100,
  };
 }

 async bankStatementCandidates(user: AuthenticatedUser, importId: string, lineId: string) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  const line = await this.db.query<{bank_account_id:string;transaction_date:string;debit:string|number;credit:string|number;status:string}>(
   `SELECT bank_account_id,transaction_date,debit,credit,status FROM bank_statement_lines
    WHERE company_id=$1 AND statement_import_id=$2 AND id=$3`,
   [companyId,importId,lineId],
  );
  if (!line.rows[0]) throw new NotFoundException('Statement line not found.');
  if (line.rows[0].status==='matched') throw new ConflictException('This statement line is already matched.');
  const statementNet = Number(line.rows[0].credit)-Number(line.rows[0].debit);
  return (await this.db.query(
   `SELECT j.id,j.entry_number,j.entry_date,j.description,
      SUM(l.debit-l.credit)::numeric(14,2) AS bank_movement
    FROM journal_entries j
    JOIN journal_entry_lines l ON l.journal_entry_id=j.id AND l.company_id=j.company_id
      AND l.account_id=$2
    WHERE j.company_id=$1 AND j.status='posted'
      AND j.entry_date BETWEEN $3::date-INTERVAL '7 days' AND $3::date+INTERVAL '7 days'
      AND NOT EXISTS (
       SELECT 1 FROM bank_statement_lines matched
       WHERE matched.company_id=$1 AND matched.bank_account_id=$2 AND matched.matched_journal_entry_id=j.id
      )
    GROUP BY j.id
    HAVING ABS(SUM(l.debit-l.credit)-$4::numeric)<=0.01
    ORDER BY ABS(j.entry_date-$3::date),j.entry_date DESC
    LIMIT 25`,
   [companyId,line.rows[0].bank_account_id,line.rows[0].transaction_date,statementNet],
  )).rows;
 }

 async unmatchBankStatementLine(user: AuthenticatedUser, importId: string, lineId: string) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  await this.db.transaction(async client => {
   const line = await client.query<{id:string;status:string;matched_journal_entry_id:string|null}>(
    'SELECT id,status,matched_journal_entry_id FROM bank_statement_lines WHERE company_id=$1 AND statement_import_id=$2 AND id=$3 FOR UPDATE',
    [companyId,importId,lineId],
   );
   if(!line.rows[0])throw new NotFoundException('Statement line not found.');
   if(line.rows[0].status!=='matched')throw new ConflictException('Only a matched statement line can be unmatched.');
   await client.query(
    `UPDATE bank_statement_lines SET status='unmatched',matched_journal_entry_id=NULL,matched_by=NULL,matched_at=NULL
     WHERE company_id=$1 AND statement_import_id=$2 AND id=$3`,
    [companyId,importId,lineId],
   );
   await client.query(
    `UPDATE bank_statement_imports SET status='imported',reconciled_at=NULL WHERE company_id=$1 AND id=$2`,
    [companyId,importId],
   );
   await this.audit.logInTransaction(client,{
    userId:user.userId,companyId,branchId:null,action:'accounting.bank_statement.unmatch',
    entityType:'bank_statement_line',entityId:lineId,
    oldValues:{status:'matched',journalEntryId:line.rows[0].matched_journal_entry_id},
    newValues:{status:'unmatched'},ipAddress:null,
   });
  });
  return this.getBankStatementImport(user,importId);
 }

 async matchBankStatementLine(user: AuthenticatedUser, importId: string, lineId: string, journalEntryId: string) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  await this.db.transaction(async client => {
   const lineResult = await client.query<{
    id:string;bank_account_id:string;transaction_date:string;debit:string|number;credit:string|number;status:string;
   }>(
    `SELECT id,bank_account_id,transaction_date,debit,credit,status FROM bank_statement_lines
     WHERE company_id=$1 AND statement_import_id=$2 AND id=$3 FOR UPDATE`,
    [companyId,importId,lineId],
   );
   const line=lineResult.rows[0];
   if(!line)throw new NotFoundException('Statement line not found.');
   if(line.status==='matched')throw new ConflictException('This statement line is already matched.');
   const journalLock=await client.query<{id:string}>(
    'SELECT id FROM journal_entries WHERE company_id=$1 AND id=$2 AND status=\'posted\' FOR SHARE',
    [companyId,journalEntryId],
   );
   if(!journalLock.rows[0])throw new BadRequestException('The selected journal entry is not posted or does not belong to this company.');
   const journal=await client.query<{id:string}>(
    `SELECT j.id FROM journal_entries j
     JOIN journal_entry_lines l ON l.journal_entry_id=j.id AND l.company_id=j.company_id AND l.account_id=$3
     WHERE j.company_id=$1 AND j.id=$2 AND j.status='posted'
       AND j.entry_date BETWEEN $4::date-INTERVAL '7 days' AND $4::date+INTERVAL '7 days'
     GROUP BY j.id
     HAVING ABS(SUM(l.debit-l.credit)-$5::numeric)<=0.01`,
    [companyId,journalEntryId,line.bank_account_id,line.transaction_date,Number(line.credit)-Number(line.debit)],
   );
   if(!journal.rows[0])throw new BadRequestException('The selected journal does not match this bank account, date window and statement amount.');
   await client.query(
    `UPDATE bank_statement_lines SET status='matched',matched_journal_entry_id=$1,matched_by=$2,matched_at=NOW()
     WHERE company_id=$3 AND statement_import_id=$4 AND id=$5 AND status='unmatched'`,
    [journalEntryId,user.userId,companyId,importId,lineId],
   );
   await client.query(
    `UPDATE bank_statement_imports i SET status=CASE
      WHEN NOT EXISTS(SELECT 1 FROM bank_statement_lines l WHERE l.company_id=i.company_id AND l.statement_import_id=i.id AND l.status='unmatched')
       AND ABS(i.closing_balance-(i.opening_balance+COALESCE((SELECT SUM(l.credit-l.debit) FROM bank_statement_lines l WHERE l.company_id=i.company_id AND l.statement_import_id=i.id),0)))<=0.01
      THEN 'reconciled' ELSE 'imported' END,
      reconciled_at=CASE
       WHEN NOT EXISTS(SELECT 1 FROM bank_statement_lines l WHERE l.company_id=i.company_id AND l.statement_import_id=i.id AND l.status='unmatched')
        AND ABS(i.closing_balance-(i.opening_balance+COALESCE((SELECT SUM(l.credit-l.debit) FROM bank_statement_lines l WHERE l.company_id=i.company_id AND l.statement_import_id=i.id),0)))<=0.01
       THEN NOW() ELSE NULL END
     WHERE i.company_id=$1 AND i.id=$2`,
    [companyId,importId],
   );
   await this.audit.logInTransaction(client,{
    userId:user.userId,companyId,branchId:null,action:'accounting.bank_statement.match',
    entityType:'bank_statement_line',entityId:lineId,oldValues:{status:'unmatched'},
    newValues:{status:'matched',journalEntryId},ipAddress:null,
   });
  });
  return this.getBankStatementImport(user,importId);
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

 async withholdingTaxSchedule(user: AuthenticatedUser, startDate: string, endDate: string) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  this.validateDate(startDate, 'startDate');
  this.validateDate(endDate, 'endDate');
  if (startDate > endDate) throw new BadRequestException('startDate must be on or before endDate.');
  const currency = await this.getCompanyCurrency(companyId);
  const result = await this.db.query<{
   payment_date: string; supplier_name: string; kra_pin: string|null; bill_number: string;
   supplier_invoice_number: string|null; amount: string|number; cash_amount: string|number;
   withholding_tax_amount: string|number; withholding_certificate_number: string|null; reference: string|null;
  }>(
   `SELECT p.payment_date,s.name AS supplier_name,s.kra_pin,b.bill_number,b.supplier_invoice_number,
      p.amount,p.cash_amount,p.withholding_tax_amount,p.withholding_certificate_number,p.reference
    FROM supplier_bill_payments p
    JOIN supplier_bills b ON b.id=p.supplier_bill_id AND b.company_id=p.company_id
    JOIN suppliers s ON s.id=b.supplier_id AND s.company_id=b.company_id
    WHERE p.company_id=$1 AND p.payment_date>=$2::date AND p.payment_date<=$3::date
      AND p.withholding_tax_amount>0
    ORDER BY p.payment_date,s.name,b.bill_number`,
   [companyId, startDate, endDate],
  );
  const payments = result.rows.map(row => ({
   ...row, amount: Number(row.amount), cash_amount: Number(row.cash_amount),
   withholding_tax_amount: Number(row.withholding_tax_amount),
  }));
  return {
   companyId, currency, startDate, endDate, payments,
   totalGrossPayments: payments.reduce((sum,row)=>sum+row.amount,0),
   totalCashPaid: payments.reduce((sum,row)=>sum+row.cash_amount,0),
   totalWithholdingTax: payments.reduce((sum,row)=>sum+row.withholding_tax_amount,0),
  };
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

  const [accounts, earnings] = await Promise.all([
   this.db.query<{
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
    [companyId, asOfDate]),
   this.db.query<{ current_earnings: string | number }>(
    `SELECT COALESCE(SUM(CASE WHEN a.account_type='income' THEN l.credit-l.debit ELSE l.debit-l.credit END),0)::numeric(14,2) AS current_earnings
     FROM chart_of_accounts a
     JOIN journal_entry_lines l ON l.account_id=a.id AND l.company_id=a.company_id
     JOIN journal_entries j ON j.id=l.journal_entry_id AND j.company_id=l.company_id
     WHERE a.company_id=$1 AND a.account_type IN ('income','expense') AND j.status='posted' AND j.entry_date<=$2::date`,
    [companyId, asOfDate]),
  ]);

  const rows = accounts.rows.map(r => ({ ...r, balance: Number(r.balance) }));
  const assetAccounts = rows.filter(a => a.account_type === 'asset');
  const liabilityAccounts = rows.filter(a => a.account_type === 'liability');
  const equityAccounts = rows.filter(a => a.account_type === 'equity');
  const currentEarnings = Number(earnings.rows[0]?.current_earnings ?? 0);
  if (Math.abs(currentEarnings) > 0.005) {
   equityAccounts.push({
    id: 'calculated-current-earnings', code: '—', name: 'Current / retained earnings',
    account_type: 'equity', system_code: 'calculated_retained_earnings', balance: currentEarnings,
   });
  }

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
  const categories = await this.db.query<{ category: 'operating'|'investing'|'financing'; amount: string|number }>(
   `WITH cash_entries AS (
     SELECT j.id
     FROM journal_entries j
     JOIN journal_entry_lines cash_line ON cash_line.journal_entry_id=j.id AND cash_line.company_id=j.company_id
     JOIN chart_of_accounts cash_account ON cash_account.id=cash_line.account_id AND cash_account.company_id=j.company_id
     WHERE j.company_id=$1 AND j.status='posted' AND j.entry_date>=$2::date AND j.entry_date<=$3::date
       AND cash_account.system_code IN ('cash','bank','mpesa')
     GROUP BY j.id
     HAVING ABS(SUM(cash_line.debit-cash_line.credit))>0.005
    ), counterpart_movements AS (
     SELECT
      CASE
       WHEN account.cash_flow_category IS NOT NULL THEN account.cash_flow_category
       WHEN account.system_code IN ('accounts_receivable','accounts_payable','inventory','input_tax','output_tax','goods_received_not_invoiced','customer_credits','withholding_tax_payable') THEN 'operating'
       WHEN account.account_type IN ('income','expense') THEN 'operating'
       WHEN account.account_type='equity' THEN 'financing'
       WHEN account.account_type IN ('asset','liability') THEN NULL
       ELSE 'operating'
      END AS category,
      SUM(line.credit-line.debit) AS amount
     FROM cash_entries ce
     JOIN journal_entries j ON j.id=ce.id AND j.company_id=$1
     JOIN journal_entry_lines line ON line.journal_entry_id=j.id AND line.company_id=j.company_id
     JOIN chart_of_accounts account ON account.id=line.account_id AND account.company_id=line.company_id
     WHERE account.system_code IS NULL OR account.system_code NOT IN ('cash','bank','mpesa')
     GROUP BY 1
    )
    SELECT category,COALESCE(SUM(amount),0)::numeric(14,2) AS amount
    FROM counterpart_movements GROUP BY category ORDER BY category`,
   [companyId, startDate, endDate],
  );
  const cashFlowCategories = (['operating','investing','financing'] as const).map(category => ({
   category, amount: Number(categories.rows.find(row => row.category === category)?.amount ?? 0),
  }));
  const classifiedMovement = cashFlowCategories.reduce((sum, item) => sum + item.amount, 0);
  const classificationVariance = Math.round((netCashMovement - classifiedMovement) * 100) / 100;

  return {
   currency, startDate, endDate, cashAccounts, cashFlowCategories,
   totalOpeningBalance: totalOpening,
   totalClosingBalance: totalClosing,
   netCashMovement,
   classificationVariance,
   method: 'direct',
  };
 }
}
+params.length;}
  return (await this.db.query(
   `SELECT b.id,b.fiscal_year,b.period_month,b.budget_amount,b.status,
      a.id AS account_id,a.code AS account_code,a.name AS account_name,a.account_type,
      cc.id AS cost_centre_id,cc.code AS cost_centre_code,cc.name AS cost_centre_name,
      COALESCE(SUM(CASE WHEN j.id IS NOT NULL THEN CASE WHEN a.account_type='income' THEN l.credit-l.debit ELSE l.debit-l.credit END ELSE 0 END),0)::numeric(14,2) AS actual_amount,
      CASE WHEN a.account_type='income'
       THEN (COALESCE(SUM(CASE WHEN j.id IS NOT NULL THEN l.credit-l.debit ELSE 0 END),0)-b.budget_amount)
       ELSE (b.budget_amount-COALESCE(SUM(CASE WHEN j.id IS NOT NULL THEN l.debit-l.credit ELSE 0 END),0))
      END::numeric(14,2) AS favourable_variance
    FROM budgets b
    JOIN chart_of_accounts a ON a.id=b.account_id AND a.company_id=b.company_id
    LEFT JOIN cost_centres cc ON cc.id=b.cost_centre_id AND cc.company_id=b.company_id
    LEFT JOIN journal_entry_lines l ON l.company_id=b.company_id AND l.account_id=b.account_id
      AND l.cost_centre_id IS NOT DISTINCT FROM b.cost_centre_id
    LEFT JOIN journal_entries j ON j.id=l.journal_entry_id AND j.company_id=l.company_id
      AND j.status='posted' AND j.entry_date>=make_date(b.fiscal_year,b.period_month,1)
      AND j.entry_date<(make_date(b.fiscal_year,b.period_month,1)+INTERVAL '1 month')
    WHERE b.company_id=$1 ${filter}
    GROUP BY b.id,a.id,cc.id
    ORDER BY b.fiscal_year DESC,b.period_month DESC,a.code,cc.code`,
   params,
  )).rows;
 }

 async listFixedAssets(user: AuthenticatedUser) {
  const membership=await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  return (await this.db.query(
   `SELECT f.*,asset_account.code AS asset_account_code,asset_account.name AS asset_account_name,
      accumulated_account.name AS accumulated_depreciation_account_name,
      expense_account.name AS depreciation_expense_account_name,payment_account.name AS payment_account_name,
      (f.cost-f.accumulated_depreciation)::numeric(14,2) AS net_book_value
    FROM fixed_assets f
    JOIN chart_of_accounts asset_account ON asset_account.id=f.asset_account_id AND asset_account.company_id=f.company_id
    JOIN chart_of_accounts accumulated_account ON accumulated_account.id=f.accumulated_depreciation_account_id AND accumulated_account.company_id=f.company_id
    JOIN chart_of_accounts expense_account ON expense_account.id=f.depreciation_expense_account_id AND expense_account.company_id=f.company_id
    JOIN chart_of_accounts payment_account ON payment_account.id=f.payment_account_id AND payment_account.company_id=f.company_id
    WHERE f.company_id=$1 ORDER BY f.status,f.asset_code`,
   [membership.companyId],
  )).rows;
 }

 async getFixedAsset(user: AuthenticatedUser,id:string) {
  const membership=await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const header=await this.db.query(
   `SELECT f.*,asset_account.code AS asset_account_code,asset_account.name AS asset_account_name,
      accumulated_account.name AS accumulated_depreciation_account_name,
      expense_account.name AS depreciation_expense_account_name,payment_account.name AS payment_account_name,
      (f.cost-f.accumulated_depreciation)::numeric(14,2) AS net_book_value
    FROM fixed_assets f
    JOIN chart_of_accounts asset_account ON asset_account.id=f.asset_account_id AND asset_account.company_id=f.company_id
    JOIN chart_of_accounts accumulated_account ON accumulated_account.id=f.accumulated_depreciation_account_id AND accumulated_account.company_id=f.company_id
    JOIN chart_of_accounts expense_account ON expense_account.id=f.depreciation_expense_account_id AND expense_account.company_id=f.company_id
    JOIN chart_of_accounts payment_account ON payment_account.id=f.payment_account_id AND payment_account.company_id=f.company_id
    WHERE f.company_id=$1 AND f.id=$2`,
   [membership.companyId,id],
  );
  if(!header.rows[0])throw new NotFoundException('Fixed asset not found.');
  const schedule=await this.db.query(
   `SELECT d.*,j.entry_number FROM fixed_asset_depreciation d
    JOIN journal_entries j ON j.id=d.journal_entry_id AND j.company_id=d.company_id
    WHERE d.company_id=$1 AND d.asset_id=$2 ORDER BY d.period_end`,
   [membership.companyId,id],
  );
  return {...header.rows[0],depreciationSchedule:schedule.rows};
 }

 async createFixedAsset(user:AuthenticatedUser,dto:CreateFixedAssetDto) {
  const membership=await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const {companyId}=membership;
  const acquisitionDate=this.validateDate(dto.acquisitionDate,'acquisitionDate');
  const cost=Math.round(Number(dto.cost)*100)/100;
  const residualValue=Math.round(Number(dto.residualValue??0)*100)/100;
  const usefulLifeMonths=Number(dto.usefulLifeMonths);
  if(!Number.isFinite(cost)||cost<=0||!Number.isFinite(residualValue)||residualValue<0||residualValue>cost||!Number.isInteger(usefulLifeMonths)||usefulLifeMonths<1)throw new BadRequestException('Enter a positive asset cost, a valid residual value and a whole-number useful life in months.');
  const assetCode=dto.assetCode.trim();
  const name=dto.name.trim();
  if(!assetCode||!name)throw new BadRequestException('Asset code and name are required.');
  const id=await this.db.transaction(async client=>{
   await this.ensureDefaults(companyId,client);
   const accountIds=[dto.assetAccountId,dto.accumulatedDepreciationAccountId,dto.depreciationExpenseAccountId,dto.paymentAccountId];
   if(new Set(accountIds).size!==4)throw new BadRequestException('Select four distinct ledger accounts for the asset.');
   const accounts=await client.query<{id:string;account_type:string;normal_side:string;system_code:string|null}>(
    'SELECT id,account_type,normal_side,system_code FROM chart_of_accounts WHERE company_id=$1 AND id=ANY($2::uuid[]) AND is_active=true FOR SHARE',
    [companyId,accountIds],
   );
   if(accounts.rows.length!==4)throw new BadRequestException('All fixed asset ledger accounts must be active and belong to this company.');
   const byId=new Map(accounts.rows.map(a=>[a.id,a]));
   if(byId.get(dto.assetAccountId)?.account_type!=='asset')throw new BadRequestException('The fixed asset account must be an asset account.');
   if(byId.get(dto.accumulatedDepreciationAccountId)?.account_type!=='asset'||byId.get(dto.accumulatedDepreciationAccountId)?.normal_side!=='credit')throw new BadRequestException('Accumulated depreciation must use a credit-normal asset account.');
   if(byId.get(dto.depreciationExpenseAccountId)?.account_type!=='expense')throw new BadRequestException('Depreciation must use an expense account.');
   const paymentAccount=byId.get(dto.paymentAccountId);
   if(paymentAccount?.account_type!=='asset'||!['cash','bank','mpesa'].includes(paymentAccount.system_code??''))throw new BadRequestException('Select an active cash, bank or M-Pesa ledger account for the acquisition payment.');
   const asset=await client.query<{id:string}>(
    `INSERT INTO fixed_assets(company_id,asset_code,name,description,acquisition_date,cost,residual_value,useful_life_months,
      asset_account_id,accumulated_depreciation_account_id,depreciation_expense_account_id,payment_account_id,created_by)
     VALUES($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [companyId,assetCode,name,dto.description?.trim()||null,acquisitionDate,cost,residualValue,usefulLifeMonths,
     dto.assetAccountId,dto.accumulatedDepreciationAccountId,dto.depreciationExpenseAccountId,dto.paymentAccountId,user.userId],
   );
   const year=Number(acquisitionDate.slice(0,4));
   const sequence=await client.query<{next_number:number}>(
    `INSERT INTO journal_entry_sequences(company_id,entry_year,next_number) VALUES($1,$2,1)
     ON CONFLICT(company_id,entry_year) DO UPDATE SET next_number=journal_entry_sequences.next_number+1 RETURNING next_number`,
    [companyId,year],
   );
   const entryNumber=`JE-${year}-${String(sequence.rows[0].next_number).padStart(6,'0')}`;
   const journal=await client.query<{id:string}>(
    `INSERT INTO journal_entries(company_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by)
     VALUES($1,$2,$3::date,$4,'fixed_asset_acquisition',$5,'posted',NOW(),$6) RETURNING id`,
    [companyId,entryNumber,acquisitionDate,`Acquire fixed asset ${assetCode} - ${name}`,asset.rows[0].id,user.userId],
   );
   await client.query(
    `INSERT INTO journal_entry_lines(company_id,journal_entry_id,account_id,description,debit,credit)
     VALUES($1,$2,$3,$4,$5,0),($1,$2,$6,$7,0,$5)`,
    [companyId,journal.rows[0].id,dto.assetAccountId,`Capitalise asset ${assetCode}`,cost,dto.paymentAccountId,`Cash/bank payment for asset ${assetCode}`],
   );
   await client.query('UPDATE fixed_assets SET acquisition_journal_entry_id=$1 WHERE company_id=$2 AND id=$3',[journal.rows[0].id,companyId,asset.rows[0].id]);
   await this.audit.logInTransaction(client,{
    userId:user.userId,companyId,branchId:null,action:'accounting.fixed_asset.create',
    entityType:'fixed_asset',entityId:asset.rows[0].id,oldValues:null,
    newValues:{assetCode,name,cost,residualValue,usefulLifeMonths,acquisitionJournalEntryId:journal.rows[0].id},ipAddress:null,
   });
   return asset.rows[0].id;
  });
  return this.getFixedAsset(user,id);
 }

 async depreciateFixedAsset(user:AuthenticatedUser,id:string,periodEndInput:string) {
  const membership=await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const {companyId}=membership;
  const periodEnd=this.validateDate(periodEndInput,'periodEnd');
  const periodDate=new Date(periodEnd+'T00:00:00.000Z');
  const periodYear=periodDate.getUTCFullYear(),periodMonth=periodDate.getUTCMonth()+1;
  const monthEnd=new Date(Date.UTC(periodYear,periodMonth,0)).toISOString().slice(0,10);
  if(monthEnd!==periodEnd)throw new BadRequestException('Depreciation must be posted at month end.');
  await this.db.transaction(async client=>{
   const assetResult=await client.query<{
    id:string;asset_code:string;name:string;acquisition_date:string;cost:string|number;residual_value:string|number;
    useful_life_months:number;accumulated_depreciation:string|number;asset_account_id:string;
    accumulated_depreciation_account_id:string;depreciation_expense_account_id:string;status:string;
   }>(
    'SELECT id,asset_code,name,acquisition_date,cost,residual_value,useful_life_months,accumulated_depreciation,asset_account_id,accumulated_depreciation_account_id,depreciation_expense_account_id,status FROM fixed_assets WHERE company_id=$1 AND id=$2 FOR UPDATE',
    [companyId,id],
   );
   const asset=assetResult.rows[0];
   if(!asset)throw new NotFoundException('Fixed asset not found.');
   if(asset.status!=='active')throw new ConflictException('Only active fixed assets can be depreciated.');
   const acquisition=new Date(asset.acquisition_date+'T00:00:00.000Z');
   const firstPeriod=new Date(Date.UTC(acquisition.getUTCFullYear(),acquisition.getUTCMonth()+2,0)).toISOString().slice(0,10);
   if(periodEnd<firstPeriod)throw new BadRequestException('The first straight-line depreciation period is the month end after the acquisition month.');
   const latest=await client.query<{period_end:string|null}>(
    'SELECT MAX(period_end)::text AS period_end FROM fixed_asset_depreciation WHERE company_id=$1 AND asset_id=$2',
    [companyId,id],
   );
   const expectedPeriod=latest.rows[0]?.period_end
    ? new Date(Date.UTC(new Date(latest.rows[0].period_end+'T00:00:00.000Z').getUTCFullYear(),new Date(latest.rows[0].period_end+'T00:00:00.000Z').getUTCMonth()+2,0)).toISOString().slice(0,10)
    : firstPeriod;
   if(periodEnd!==expectedPeriod)throw new ConflictException(`Depreciation periods must be posted monthly in order. Next period: ${expectedPeriod}.`);
   const depreciableBase=Math.round((Number(asset.cost)-Number(asset.residual_value))*100)/100;
   const accumulated=Number(asset.accumulated_depreciation);
   const monthly=Math.round((depreciableBase/Number(asset.useful_life_months))*100)/100;
   const amount=Math.round(Math.min(monthly,depreciableBase-accumulated)*100)/100;
   if(amount<=0)throw new ConflictException('This asset has no remaining depreciable value.');
   const year=periodYear;
   const sequence=await client.query<{next_number:number}>(
    `INSERT INTO journal_entry_sequences(company_id,entry_year,next_number) VALUES($1,$2,1)
     ON CONFLICT(company_id,entry_year) DO UPDATE SET next_number=journal_entry_sequences.next_number+1 RETURNING next_number`,
    [companyId,year],
   );
   const entryNumber=`JE-${year}-${String(sequence.rows[0].next_number).padStart(6,'0')}`;
   const journal=await client.query<{id:string}>(
    `INSERT INTO journal_entries(company_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by)
     VALUES($1,$2,$3::date,$4,'fixed_asset_depreciation',NULL,'posted',NOW(),$5) RETURNING id`,
    [companyId,entryNumber,periodEnd,`Monthly depreciation - ${asset.asset_code} - ${asset.name}`,user.userId],
   );
   const depreciation=await client.query<{id:string}>(
    `INSERT INTO fixed_asset_depreciation(company_id,asset_id,period_end,depreciation_amount,journal_entry_id,posted_by)
     VALUES($1,$2,$3::date,$4,$5,$6) RETURNING id`,
    [companyId,id,periodEnd,amount,journal.rows[0].id,user.userId],
   );
   await client.query(
    `INSERT INTO journal_entry_lines(company_id,journal_entry_id,account_id,description,debit,credit)
     VALUES($1,$2,$3,$4,$5,0),($1,$2,$6,$7,0,$5)`,
    [companyId,journal.rows[0].id,asset.depreciation_expense_account_id,`Depreciation expense - ${asset.asset_code}`,amount,asset.accumulated_depreciation_account_id,`Accumulated depreciation - ${asset.asset_code}`],
   );
   const newAccumulated=Math.round((accumulated+amount)*100)/100;
   const fullyDepreciated=newAccumulated>=depreciableBase-0.005;
   await client.query(
    'UPDATE fixed_assets SET accumulated_depreciation=$1,status=$2,updated_at=NOW() WHERE company_id=$3 AND id=$4',
    [fullyDepreciated?depreciableBase:newAccumulated,fullyDepreciated?'fully_depreciated':'active',companyId,id],
   );
   await this.audit.logInTransaction(client,{
    userId:user.userId,companyId,branchId:null,action:'accounting.fixed_asset.depreciate',
    entityType:'fixed_asset',entityId:id,oldValues:{accumulatedDepreciation:accumulated,status:asset.status},
    newValues:{periodEnd,depreciationAmount:amount,journalEntryId:journal.rows[0].id,accumulatedDepreciation:fullyDepreciated?depreciableBase:newAccumulated},ipAddress:null,
   });
  });
  return this.getFixedAsset(user,id);
 }

 async listBankStatements(user: AuthenticatedUser) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  return (await this.db.query(
   `SELECT i.*,a.code AS account_code,a.name AS account_name,
     COUNT(l.id)::int AS line_count,
     COUNT(l.id) FILTER (WHERE l.status='matched')::int AS matched_count,
     COUNT(l.id) FILTER (WHERE l.status='unmatched')::int AS unmatched_count,
     COALESCE(SUM(l.credit-l.debit),0)::numeric(14,2) AS statement_net_movement,
     (i.opening_balance+COALESCE(SUM(l.credit-l.debit),0))::numeric(14,2) AS calculated_closing_balance,
     (i.closing_balance-(i.opening_balance+COALESCE(SUM(l.credit-l.debit),0)))::numeric(14,2) AS closing_variance
    FROM bank_statement_imports i
    JOIN chart_of_accounts a ON a.id=i.bank_account_id AND a.company_id=i.company_id
    LEFT JOIN bank_statement_lines l ON l.statement_import_id=i.id AND l.company_id=i.company_id
    WHERE i.company_id=$1
    GROUP BY i.id,a.code,a.name
    ORDER BY i.statement_end DESC,i.created_at DESC`,
   [companyId],
  )).rows;
 }

 async importBankStatement(user: AuthenticatedUser, dto: CreateBankStatementDto) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  const statementStart = this.validateDate(dto.statementStart, 'statementStart');
  const statementEnd = this.validateDate(dto.statementEnd, 'statementEnd');
  if (statementStart > statementEnd) throw new BadRequestException('Statement end must be on or after statement start.');
  if (!Array.isArray(dto.lines) || dto.lines.length < 1) throw new BadRequestException('A statement import requires at least one transaction line.');
  const openingBalance = Math.round(Number(dto.openingBalance) * 100) / 100;
  const closingBalance = Math.round(Number(dto.closingBalance) * 100) / 100;
  if (!Number.isFinite(openingBalance) || !Number.isFinite(closingBalance)) throw new BadRequestException('Statement balances must be valid amounts.');
  const lines = dto.lines.map((line,index) => {
   const transactionDate = this.validateDate(line.transactionDate, `lines[${index}].transactionDate`);
   if (transactionDate < statementStart || transactionDate > statementEnd) throw new BadRequestException(`Statement line ${index+1} falls outside the statement period.`);
   const debit = Math.round(Number(line.debit ?? 0) * 100) / 100;
   const credit = Math.round(Number(line.credit ?? 0) * 100) / 100;
   if (!line.description.trim() || !Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0 || (debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
    throw new BadRequestException(`Statement line ${index+1} must have a description and exactly one positive debit or credit amount.`);
   }
   const runningBalance = line.runningBalance == null ? null : Math.round(Number(line.runningBalance)*100)/100;
   if (runningBalance != null && !Number.isFinite(runningBalance)) throw new BadRequestException(`Statement line ${index+1} has an invalid running balance.`);
   return { transactionDate, description: line.description.trim(), reference: line.reference?.trim() || null, debit, credit, runningBalance };
  });
  const id = await this.db.transaction(async client => {
   const account = await client.query<{ id:string; system_code:string|null }>(
    `SELECT id,system_code FROM chart_of_accounts WHERE company_id=$1 AND id=$2 AND is_active=true AND system_code IN ('bank','mpesa') FOR SHARE`,
    [companyId,dto.accountId],
   );
   if (!account.rows[0]) throw new BadRequestException('Select an active company bank or M-Pesa ledger account.');
   const inserted = await client.query<{id:string}>(
    `INSERT INTO bank_statement_imports(company_id,bank_account_id,statement_start,statement_end,opening_balance,closing_balance,file_name,created_by)
     VALUES($1,$2,$3::date,$4::date,$5,$6,$7,$8) RETURNING id`,
    [companyId,dto.accountId,statementStart,statementEnd,openingBalance,closingBalance,dto.fileName?.trim()||null,user.userId],
   );
   for (const line of lines) {
    await client.query(
     `INSERT INTO bank_statement_lines(company_id,statement_import_id,bank_account_id,transaction_date,description,reference,debit,credit,running_balance)
      VALUES($1,$2,$3,$4::date,$5,$6,$7,$8,$9)`,
     [companyId,inserted.rows[0].id,dto.accountId,line.transactionDate,line.description,line.reference,line.debit,line.credit,line.runningBalance],
    );
   }
   await this.audit.logInTransaction(client,{
    userId:user.userId,companyId,branchId:null,action:'accounting.bank_statement.import',
    entityType:'bank_statement_import',entityId:inserted.rows[0].id,oldValues:null,
    newValues:{accountId:dto.accountId,statementStart,statementEnd,lineCount:lines.length,fileName:dto.fileName??null},ipAddress:null,
   });
   return inserted.rows[0].id;
  });
  return this.getBankStatementImport(user,id);
 }

 async getBankStatementImport(user: AuthenticatedUser, id: string) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  const result = await this.db.query(
   `SELECT i.*,a.code AS account_code,a.name AS account_name
    FROM bank_statement_imports i JOIN chart_of_accounts a ON a.id=i.bank_account_id AND a.company_id=i.company_id
    WHERE i.company_id=$1 AND i.id=$2`,
   [companyId,id],
  );
  if (!result.rows[0]) throw new NotFoundException('Bank statement import not found.');
  const lines = await this.db.query(
   `SELECT l.*,j.entry_number AS matched_entry_number,j.entry_date AS matched_entry_date,j.description AS matched_entry_description
    FROM bank_statement_lines l
    LEFT JOIN journal_entries j ON j.id=l.matched_journal_entry_id AND j.company_id=l.company_id
    WHERE l.company_id=$1 AND l.statement_import_id=$2
    ORDER BY l.transaction_date,l.created_at,l.id`,
   [companyId,id],
  );
  const header = result.rows[0] as Record<string,unknown>;
  const lineRows = lines.rows as Array<Record<string,unknown>>;
  const statementNetMovement = lineRows.reduce((sum,line)=>sum+Number(line.credit)-Number(line.debit),0);
  const calculatedClosingBalance = Number(header.opening_balance)+statementNetMovement;
  return {
   ...header, lines:lineRows,
   lineCount:lineRows.length,
   matchedCount:lineRows.filter(line=>line.status==='matched').length,
   unmatchedCount:lineRows.filter(line=>line.status==='unmatched').length,
   statementNetMovement:Math.round(statementNetMovement*100)/100,
   calculatedClosingBalance:Math.round(calculatedClosingBalance*100)/100,
   closingVariance:Math.round((Number(header.closing_balance)-calculatedClosingBalance)*100)/100,
  };
 }

 async bankStatementCandidates(user: AuthenticatedUser, importId: string, lineId: string) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  const line = await this.db.query<{bank_account_id:string;transaction_date:string;debit:string|number;credit:string|number;status:string}>(
   `SELECT bank_account_id,transaction_date,debit,credit,status FROM bank_statement_lines
    WHERE company_id=$1 AND statement_import_id=$2 AND id=$3`,
   [companyId,importId,lineId],
  );
  if (!line.rows[0]) throw new NotFoundException('Statement line not found.');
  if (line.rows[0].status==='matched') throw new ConflictException('This statement line is already matched.');
  const statementNet = Number(line.rows[0].credit)-Number(line.rows[0].debit);
  return (await this.db.query(
   `SELECT j.id,j.entry_number,j.entry_date,j.description,
      SUM(l.debit-l.credit)::numeric(14,2) AS bank_movement
    FROM journal_entries j
    JOIN journal_entry_lines l ON l.journal_entry_id=j.id AND l.company_id=j.company_id
      AND l.account_id=$2
    WHERE j.company_id=$1 AND j.status='posted'
      AND j.entry_date BETWEEN $3::date-INTERVAL '7 days' AND $3::date+INTERVAL '7 days'
      AND NOT EXISTS (
       SELECT 1 FROM bank_statement_lines matched
       WHERE matched.company_id=$1 AND matched.bank_account_id=$2 AND matched.matched_journal_entry_id=j.id
      )
    GROUP BY j.id
    HAVING ABS(SUM(l.debit-l.credit)-$4::numeric)<=0.01
    ORDER BY ABS(j.entry_date-$3::date),j.entry_date DESC
    LIMIT 25`,
   [companyId,line.rows[0].bank_account_id,line.rows[0].transaction_date,statementNet],
  )).rows;
 }

 async unmatchBankStatementLine(user: AuthenticatedUser, importId: string, lineId: string) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  await this.db.transaction(async client => {
   const line = await client.query<{id:string;status:string;matched_journal_entry_id:string|null}>(
    'SELECT id,status,matched_journal_entry_id FROM bank_statement_lines WHERE company_id=$1 AND statement_import_id=$2 AND id=$3 FOR UPDATE',
    [companyId,importId,lineId],
   );
   if(!line.rows[0])throw new NotFoundException('Statement line not found.');
   if(line.rows[0].status!=='matched')throw new ConflictException('Only a matched statement line can be unmatched.');
   await client.query(
    `UPDATE bank_statement_lines SET status='unmatched',matched_journal_entry_id=NULL,matched_by=NULL,matched_at=NULL
     WHERE company_id=$1 AND statement_import_id=$2 AND id=$3`,
    [companyId,importId,lineId],
   );
   await client.query(
    `UPDATE bank_statement_imports SET status='imported',reconciled_at=NULL WHERE company_id=$1 AND id=$2`,
    [companyId,importId],
   );
   await this.audit.logInTransaction(client,{
    userId:user.userId,companyId,branchId:null,action:'accounting.bank_statement.unmatch',
    entityType:'bank_statement_line',entityId:lineId,
    oldValues:{status:'matched',journalEntryId:line.rows[0].matched_journal_entry_id},
    newValues:{status:'unmatched'},ipAddress:null,
   });
  });
  return this.getBankStatementImport(user,importId);
 }

 async matchBankStatementLine(user: AuthenticatedUser, importId: string, lineId: string, journalEntryId: string) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  await this.db.transaction(async client => {
   const lineResult = await client.query<{
    id:string;bank_account_id:string;transaction_date:string;debit:string|number;credit:string|number;status:string;
   }>(
    `SELECT id,bank_account_id,transaction_date,debit,credit,status FROM bank_statement_lines
     WHERE company_id=$1 AND statement_import_id=$2 AND id=$3 FOR UPDATE`,
    [companyId,importId,lineId],
   );
   const line=lineResult.rows[0];
   if(!line)throw new NotFoundException('Statement line not found.');
   if(line.status==='matched')throw new ConflictException('This statement line is already matched.');
   const journalLock=await client.query<{id:string}>(
    'SELECT id FROM journal_entries WHERE company_id=$1 AND id=$2 AND status=\'posted\' FOR SHARE',
    [companyId,journalEntryId],
   );
   if(!journalLock.rows[0])throw new BadRequestException('The selected journal entry is not posted or does not belong to this company.');
   const journal=await client.query<{id:string}>(
    `SELECT j.id FROM journal_entries j
     JOIN journal_entry_lines l ON l.journal_entry_id=j.id AND l.company_id=j.company_id AND l.account_id=$3
     WHERE j.company_id=$1 AND j.id=$2 AND j.status='posted'
       AND j.entry_date BETWEEN $4::date-INTERVAL '7 days' AND $4::date+INTERVAL '7 days'
     GROUP BY j.id
     HAVING ABS(SUM(l.debit-l.credit)-$5::numeric)<=0.01`,
    [companyId,journalEntryId,line.bank_account_id,line.transaction_date,Number(line.credit)-Number(line.debit)],
   );
   if(!journal.rows[0])throw new BadRequestException('The selected journal does not match this bank account, date window and statement amount.');
   await client.query(
    `UPDATE bank_statement_lines SET status='matched',matched_journal_entry_id=$1,matched_by=$2,matched_at=NOW()
     WHERE company_id=$3 AND statement_import_id=$4 AND id=$5 AND status='unmatched'`,
    [journalEntryId,user.userId,companyId,importId,lineId],
   );
   await client.query(
    `UPDATE bank_statement_imports i SET status=CASE
      WHEN NOT EXISTS(SELECT 1 FROM bank_statement_lines l WHERE l.company_id=i.company_id AND l.statement_import_id=i.id AND l.status='unmatched')
       AND ABS(i.closing_balance-(i.opening_balance+COALESCE((SELECT SUM(l.credit-l.debit) FROM bank_statement_lines l WHERE l.company_id=i.company_id AND l.statement_import_id=i.id),0)))<=0.01
      THEN 'reconciled' ELSE 'imported' END,
      reconciled_at=CASE
       WHEN NOT EXISTS(SELECT 1 FROM bank_statement_lines l WHERE l.company_id=i.company_id AND l.statement_import_id=i.id AND l.status='unmatched')
        AND ABS(i.closing_balance-(i.opening_balance+COALESCE((SELECT SUM(l.credit-l.debit) FROM bank_statement_lines l WHERE l.company_id=i.company_id AND l.statement_import_id=i.id),0)))<=0.01
       THEN NOW() ELSE NULL END
     WHERE i.company_id=$1 AND i.id=$2`,
    [companyId,importId],
   );
   await this.audit.logInTransaction(client,{
    userId:user.userId,companyId,branchId:null,action:'accounting.bank_statement.match',
    entityType:'bank_statement_line',entityId:lineId,oldValues:{status:'unmatched'},
    newValues:{status:'matched',journalEntryId},ipAddress:null,
   });
  });
  return this.getBankStatementImport(user,importId);
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

 async withholdingTaxSchedule(user: AuthenticatedUser, startDate: string, endDate: string) {
  const membership = await this.companyFor(user);
  this.assertCompanyWideAccounting(membership);
  const { companyId } = membership;
  this.validateDate(startDate, 'startDate');
  this.validateDate(endDate, 'endDate');
  if (startDate > endDate) throw new BadRequestException('startDate must be on or before endDate.');
  const currency = await this.getCompanyCurrency(companyId);
  const result = await this.db.query<{
   payment_date: string; supplier_name: string; kra_pin: string|null; bill_number: string;
   supplier_invoice_number: string|null; amount: string|number; cash_amount: string|number;
   withholding_tax_amount: string|number; withholding_certificate_number: string|null; reference: string|null;
  }>(
   `SELECT p.payment_date,s.name AS supplier_name,s.kra_pin,b.bill_number,b.supplier_invoice_number,
      p.amount,p.cash_amount,p.withholding_tax_amount,p.withholding_certificate_number,p.reference
    FROM supplier_bill_payments p
    JOIN supplier_bills b ON b.id=p.supplier_bill_id AND b.company_id=p.company_id
    JOIN suppliers s ON s.id=b.supplier_id AND s.company_id=b.company_id
    WHERE p.company_id=$1 AND p.payment_date>=$2::date AND p.payment_date<=$3::date
      AND p.withholding_tax_amount>0
    ORDER BY p.payment_date,s.name,b.bill_number`,
   [companyId, startDate, endDate],
  );
  const payments = result.rows.map(row => ({
   ...row, amount: Number(row.amount), cash_amount: Number(row.cash_amount),
   withholding_tax_amount: Number(row.withholding_tax_amount),
  }));
  return {
   companyId, currency, startDate, endDate, payments,
   totalGrossPayments: payments.reduce((sum,row)=>sum+row.amount,0),
   totalCashPaid: payments.reduce((sum,row)=>sum+row.cash_amount,0),
   totalWithholdingTax: payments.reduce((sum,row)=>sum+row.withholding_tax_amount,0),
  };
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

  const [accounts, earnings] = await Promise.all([
   this.db.query<{
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
    [companyId, asOfDate]),
   this.db.query<{ current_earnings: string | number }>(
    `SELECT COALESCE(SUM(CASE WHEN a.account_type='income' THEN l.credit-l.debit ELSE l.debit-l.credit END),0)::numeric(14,2) AS current_earnings
     FROM chart_of_accounts a
     JOIN journal_entry_lines l ON l.account_id=a.id AND l.company_id=a.company_id
     JOIN journal_entries j ON j.id=l.journal_entry_id AND j.company_id=l.company_id
     WHERE a.company_id=$1 AND a.account_type IN ('income','expense') AND j.status='posted' AND j.entry_date<=$2::date`,
    [companyId, asOfDate]),
  ]);

  const rows = accounts.rows.map(r => ({ ...r, balance: Number(r.balance) }));
  const assetAccounts = rows.filter(a => a.account_type === 'asset');
  const liabilityAccounts = rows.filter(a => a.account_type === 'liability');
  const equityAccounts = rows.filter(a => a.account_type === 'equity');
  const currentEarnings = Number(earnings.rows[0]?.current_earnings ?? 0);
  if (Math.abs(currentEarnings) > 0.005) {
   equityAccounts.push({
    id: 'calculated-current-earnings', code: '—', name: 'Current / retained earnings',
    account_type: 'equity', system_code: 'calculated_retained_earnings', balance: currentEarnings,
   });
  }

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
  const categories = await this.db.query<{ category: 'operating'|'investing'|'financing'; amount: string|number }>(
   `WITH cash_entries AS (
     SELECT j.id
     FROM journal_entries j
     JOIN journal_entry_lines cash_line ON cash_line.journal_entry_id=j.id AND cash_line.company_id=j.company_id
     JOIN chart_of_accounts cash_account ON cash_account.id=cash_line.account_id AND cash_account.company_id=j.company_id
     WHERE j.company_id=$1 AND j.status='posted' AND j.entry_date>=$2::date AND j.entry_date<=$3::date
       AND cash_account.system_code IN ('cash','bank','mpesa')
     GROUP BY j.id
     HAVING ABS(SUM(cash_line.debit-cash_line.credit))>0.005
    ), counterpart_movements AS (
     SELECT
      CASE
       WHEN account.cash_flow_category IS NOT NULL THEN account.cash_flow_category
       WHEN account.system_code IN ('accounts_receivable','accounts_payable','inventory','input_tax','output_tax','goods_received_not_invoiced','customer_credits','withholding_tax_payable') THEN 'operating'
       WHEN account.account_type IN ('income','expense') THEN 'operating'
       WHEN account.account_type='equity' THEN 'financing'
       WHEN account.account_type IN ('asset','liability') THEN NULL
       ELSE 'operating'
      END AS category,
      SUM(line.credit-line.debit) AS amount
     FROM cash_entries ce
     JOIN journal_entries j ON j.id=ce.id AND j.company_id=$1
     JOIN journal_entry_lines line ON line.journal_entry_id=j.id AND line.company_id=j.company_id
     JOIN chart_of_accounts account ON account.id=line.account_id AND account.company_id=line.company_id
     WHERE account.system_code IS NULL OR account.system_code NOT IN ('cash','bank','mpesa')
     GROUP BY 1
    )
    SELECT category,COALESCE(SUM(amount),0)::numeric(14,2) AS amount
    FROM counterpart_movements GROUP BY category ORDER BY category`,
   [companyId, startDate, endDate],
  );
  const cashFlowCategories = (['operating','investing','financing'] as const).map(category => ({
   category, amount: Number(categories.rows.find(row => row.category === category)?.amount ?? 0),
  }));
  const classifiedMovement = cashFlowCategories.reduce((sum, item) => sum + item.amount, 0);
  const classificationVariance = Math.round((netCashMovement - classifiedMovement) * 100) / 100;

  return {
   currency, startDate, endDate, cashAccounts, cashFlowCategories,
   totalOpeningBalance: totalOpening,
   totalClosingBalance: totalClosing,
   netCashMovement,
   classificationVariance,
   method: 'direct',
  };
 }
}
