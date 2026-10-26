import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AccountingService } from '../accounting/accounting.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import type { CreateExpenseDto } from './dto/expense.dto.js';

@Injectable()
export class ExpensesService {
 constructor(private readonly db:DatabaseService,private readonly memberships:MembershipsService,private readonly audit:AuditService,private readonly accounting:AccountingService){}
 private companyFor(user:AuthenticatedUser){return user.companyId?this.memberships.getMembershipForCompany(user.userId,user.companyId):this.memberships.getMembership(user.userId);}
 private assertCompanyWide(membership:{branchId?:string|null}){if(membership.branchId)throw new ForbiddenException('Expenses and their accounting entries are company-wide. A company-wide finance member must access them.');}
 async list(user:AuthenticatedUser){
  const membership=await this.companyFor(user);this.assertCompanyWide(membership);const {companyId}=membership;
  return (await this.db.query(`SELECT e.id,e.company_id,e.expense_number,e.expense_date,e.description,e.category,e.amount,e.payment_method,e.reference,e.expense_account_id,a.code AS account_code,a.name AS account_name,e.journal_entry_id,e.created_at
   FROM expenses e JOIN chart_of_accounts a ON a.id=e.expense_account_id AND a.company_id=e.company_id
   WHERE e.company_id=$1 ORDER BY e.expense_date DESC,e.created_at DESC`,[companyId])).rows;
 }
 async create(user:AuthenticatedUser,dto:CreateExpenseDto){
  const membership=await this.companyFor(user);this.assertCompanyWide(membership);const companyId=membership.companyId;
  const amount=Math.round(dto.amount*100)/100;
  if(!Number.isFinite(amount)||amount<=0)throw new BadRequestException('Expense amount must be greater than zero.');
  let expenseId:string;
  try{
   expenseId=await this.db.transaction(async client=>{
    const expenseAccount=dto.expenseAccountId
     ? await client.query<{id:string;code:string;name:string}>(`SELECT id,code,name FROM chart_of_accounts WHERE company_id=$1 AND id=$2 AND account_type='expense' AND is_active=true FOR SHARE`,[companyId,dto.expenseAccountId])
     : await client.query<{id:string;code:string;name:string}>(`SELECT id,code,name FROM chart_of_accounts WHERE company_id=$1 AND system_code='operating_expense' AND account_type='expense' AND is_active=true FOR SHARE`,[companyId]);
    if(!expenseAccount.rows[0])throw new BadRequestException('Choose an active expense account belonging to this company.');
    const cashSystem=dto.paymentMethod==='cash'?'cash':dto.paymentMethod==='mpesa'?'mpesa':'bank';
    const cashAccount=await client.query<{id:string}>(`SELECT id FROM chart_of_accounts WHERE company_id=$1 AND system_code=$2 AND is_active=true FOR SHARE`,[companyId,cashSystem]);
    if(!cashAccount.rows[0])throw new BadRequestException(`Required payment account "${cashSystem}" is missing or inactive.`);
    await this.accounting.ensureDefaults(companyId);
    const date=dto.expenseDate??new Date().toISOString().slice(0,10);
    const year=Number(date.slice(0,4));
    const seq=await client.query<{next_number:number}>(`INSERT INTO expense_sequences(company_id,expense_year,next_number) VALUES($1,$2,1)
     ON CONFLICT(company_id,expense_year) DO UPDATE SET next_number=expense_sequences.next_number+1 RETURNING next_number`,[companyId,year]);
    const number=`EXP-${year}-${String(seq.rows[0].next_number).padStart(5,'0')}`;
    const inserted=await client.query<{id:string}>(`INSERT INTO expenses(company_id,expense_number,expense_date,description,category,amount,payment_method,reference,expense_account_id,created_by)
     VALUES($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[companyId,number,date,dto.description.trim(),dto.category.trim(),amount,dto.paymentMethod,dto.reference?.trim()||null,expenseAccount.rows[0].id,user.userId]);
    const expense=inserted.rows[0];
    const journalYear=year;
    const journalSeq=await client.query<{next_number:number}>(`INSERT INTO journal_entry_sequences(company_id,entry_year,next_number) VALUES($1,$2,1)
     ON CONFLICT(company_id,entry_year) DO UPDATE SET next_number=journal_entry_sequences.next_number+1 RETURNING next_number`,[companyId,journalYear]);
    const journalNumber=`JE-${journalYear}-${String(journalSeq.rows[0].next_number).padStart(6,'0')}`;
    const journal=await client.query<{id:string}>(`INSERT INTO journal_entries(company_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by)
     VALUES($1,$2,$3::date,$4,'expense',$5,'posted',NOW(),$6) RETURNING id`,[companyId,journalNumber,date,`Expense: ${dto.description.trim()}`,expense.id,user.userId]);
    await client.query(`INSERT INTO journal_entry_lines(company_id,journal_entry_id,account_id,description,debit,credit) VALUES($1,$2,$3,$4,$5,0),($1,$2,$6,$7,0,$5)`,
     [companyId,journal.rows[0].id,expenseAccount.rows[0].id,dto.description.trim(),amount,cashAccount.rows[0].id,`Paid by ${dto.paymentMethod}`]);
    await client.query('UPDATE expenses SET journal_entry_id=$1 WHERE id=$2 AND company_id=$3',[journal.rows[0].id,expense.id,companyId]);
    return expense.id;
   });
  }catch(error){if((error as {code?:string}).code==='23505')throw new ConflictException('An expense with this number already exists.');throw error;}
  await this.audit.log({userId:user.userId,companyId,branchId:membership.branchId,action:'expenses.create',entityType:'expense',entityId:expenseId,oldValues:null,newValues:{amount,category:dto.category,paymentMethod:dto.paymentMethod},ipAddress:null});
  return (await this.db.query(`SELECT e.id,e.company_id,e.expense_number,e.expense_date,e.description,e.category,e.amount,e.payment_method,e.reference,e.expense_account_id,a.code AS account_code,a.name AS account_name,e.journal_entry_id,e.created_at FROM expenses e JOIN chart_of_accounts a ON a.id=e.expense_account_id AND a.company_id=e.company_id WHERE e.company_id=$1 AND e.id=$2`,[companyId,expenseId])).rows[0];
 }
}
