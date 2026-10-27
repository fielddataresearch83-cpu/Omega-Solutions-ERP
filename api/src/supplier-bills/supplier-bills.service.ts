import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import type { PoolClient } from 'pg';
import { AccountingService } from '../accounting/accounting.service.js';
import { readCompanyTaxPolicy, resolveTaxTreatment } from '../tax/tax-policy.js';
import type { CreateSupplierBillDto, RecordSupplierBillPaymentDto } from './dto/supplier-bill.dto.js';

@Injectable()
export class SupplierBillsService {
  constructor(private readonly db: DatabaseService, private readonly memberships: MembershipsService, private readonly audit: AuditService, private readonly accounting: AccountingService) {}
  private companyFor(user: AuthenticatedUser) {
    return user.companyId ? this.memberships.getMembershipForCompany(user.userId,user.companyId) : this.memberships.getMembership(user.userId);
  }
  private assertCompanyWide(membership: { branchId?: string | null }) {
    if (membership.branchId) throw new ForbiddenException('Supplier bills and payments are company-wide accounting records. A company-wide procurement member must access them.');
  }
  private async postJournal(client:PoolClient,input:{companyId:string;date:string|null;description:string;sourceType:string;sourceId:string;userId:string;lines:Array<{systemCode:string;debit:number;credit:number;description:string}>}) {
    const year=input.date?Number(input.date.slice(0,4)):new Date().getFullYear();
    const seq=await client.query<{next_number:number}>(`INSERT INTO journal_entry_sequences(company_id,entry_year,next_number) VALUES($1,$2,1)
      ON CONFLICT(company_id,entry_year) DO UPDATE SET next_number=journal_entry_sequences.next_number+1 RETURNING next_number`,[input.companyId,year]);
    const number=`JE-${year}-${String(seq.rows[0].next_number).padStart(6,'0')}`;
    const entry=await client.query<{id:string}>(`INSERT INTO journal_entries(company_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by)
      VALUES($1,$2,COALESCE($3::date,CURRENT_DATE),$4,$5,$6,'posted',NOW(),$7) RETURNING id`,
      [input.companyId,number,input.date,input.description,input.sourceType,input.sourceId,input.userId]);
    let debits=0,credits=0;
    for(const line of input.lines){
      if(line.debit<=0&&line.credit<=0)continue;
      const account=await client.query<{id:string}>('SELECT id FROM chart_of_accounts WHERE company_id=$1 AND system_code=$2 AND is_active=true',[input.companyId,line.systemCode]);
      if(!account.rows[0])throw new BadRequestException(`Required accounting account "${line.systemCode}" is missing or inactive.`);
      await client.query(`INSERT INTO journal_entry_lines(company_id,journal_entry_id,account_id,description,debit,credit) VALUES($1,$2,$3,$4,$5,$6)`,
       [input.companyId,entry.rows[0].id,account.rows[0].id,line.description,line.debit,line.credit]);
      debits+=line.debit;credits+=line.credit;
    }
    if(Math.abs(debits-credits)>0.005||debits<=0)throw new BadRequestException('Journal entry is not balanced.');
    return entry.rows[0].id;
  }
  async list(user: AuthenticatedUser) {
    const membership=await this.companyFor(user);this.assertCompanyWide(membership);const {companyId}=membership;
    return (await this.db.query(
      `SELECT b.id,b.company_id,b.supplier_id,s.name AS supplier_name,b.purchase_order_id,b.bill_number,b.supplier_invoice_number,b.bill_date,b.due_date,b.status,b.currency,b.subtotal,b.tax_amount,b.total,b.paid_amount,(b.total-b.paid_amount) AS balance,b.notes,b.created_at,b.updated_at,COUNT(i.id)::int AS item_count
       FROM supplier_bills b JOIN suppliers s ON s.id=b.supplier_id AND s.company_id=b.company_id
       LEFT JOIN supplier_bill_items i ON i.supplier_bill_id=b.id AND i.company_id=b.company_id
       WHERE b.company_id=$1 GROUP BY b.id,s.name ORDER BY b.due_date NULLS LAST,b.created_at DESC`,[companyId])).rows;
  }
  async getById(user: AuthenticatedUser,id:string) {
    const membership=await this.companyFor(user);this.assertCompanyWide(membership);const {companyId}=membership;
    const result=await this.db.query(`SELECT b.*,s.name AS supplier_name,(b.total-b.paid_amount) AS balance FROM supplier_bills b JOIN suppliers s ON s.id=b.supplier_id AND s.company_id=b.company_id WHERE b.company_id=$1 AND b.id=$2`,[companyId,id]);
    if(!result.rows[0])throw new NotFoundException('Supplier bill not found.');
    const [items,payments]=await Promise.all([
      this.db.query('SELECT * FROM supplier_bill_items WHERE company_id=$1 AND supplier_bill_id=$2 ORDER BY created_at,id',[companyId,id]),
      this.db.query('SELECT * FROM supplier_bill_payments WHERE company_id=$1 AND supplier_bill_id=$2 ORDER BY payment_date DESC,created_at DESC',[companyId,id])
    ]);
    return {...result.rows[0],items:items.rows,payments:payments.rows};
  }
  async create(user:AuthenticatedUser,dto:CreateSupplierBillDto) {
    const membership=await this.companyFor(user);this.assertCompanyWide(membership);const companyId=membership.companyId;
    const billDate=dto.billDate?.slice(0,10);
    const dueDate=dto.dueDate?.slice(0,10);
    if(billDate && dueDate && dueDate < billDate) {
      throw new BadRequestException('Supplier bill due date cannot be earlier than its bill date.');
    }
    // Validate the complete bill payload, not each line in isolation: otherwise
    // duplicate references could each pass the received-but-unbilled quantity check.
    const linkedPurchaseOrderLines = new Set<string>();
    for (const item of dto.items) {
      if (!item.purchaseOrderItemId) continue;
      if (linkedPurchaseOrderLines.has(item.purchaseOrderItemId)) {
        throw new BadRequestException('A purchase-order line can appear only once on a supplier bill.');
      }
      linkedPurchaseOrderLines.add(item.purchaseOrderItemId);
    }
    let id: string;
    try {
    id=await this.db.transaction(async client=>{
      const supplier=await client.query<{id:string}>("SELECT id FROM suppliers WHERE id=$1 AND company_id=$2 AND is_active=true AND status='active'",[dto.supplierId,companyId]);
      if(!supplier.rows[0])throw new NotFoundException('Active supplier not found in this company.');
      if(dto.supplierInvoiceNumber?.trim()){
        const duplicate=await client.query<{id:string;bill_number:string}>(
          `SELECT id,bill_number FROM supplier_bills
           WHERE company_id=$1 AND supplier_id=$2
             AND LOWER(BTRIM(supplier_invoice_number))=LOWER(BTRIM($3))
             AND status<>'void'
           LIMIT 1 FOR UPDATE`,
          [companyId,dto.supplierId,dto.supplierInvoiceNumber],
        );
        if(duplicate.rows[0])throw new ConflictException('This supplier invoice number has already been recorded for this supplier. Check the existing bill before creating another.');
      }
      if(dto.purchaseOrderId){
        const po=await client.query<{supplier_id:string;status:string}>('SELECT supplier_id,status FROM purchase_orders WHERE id=$1 AND company_id=$2 FOR SHARE',[dto.purchaseOrderId,companyId]);
        if(!po.rows[0])throw new NotFoundException('Purchase order not found in this company.');
        if(po.rows[0].supplier_id!==dto.supplierId)throw new BadRequestException('Bill supplier must match the purchase order supplier.');
        if(['draft','cancelled'].includes(po.rows[0].status))throw new BadRequestException('A bill cannot be linked to a draft or cancelled purchase order.');
      }
      const year=new Date().getFullYear();
      const seq=await client.query<{next_number:number}>(`INSERT INTO supplier_bill_sequences(company_id,bill_year,next_number) VALUES($1,$2,1) ON CONFLICT(company_id,bill_year) DO UPDATE SET next_number=supplier_bill_sequences.next_number+1 RETURNING next_number`,[companyId,year]);
      const number=`BILL-${year}-${String(seq.rows[0].next_number).padStart(5,'0')}`;
      const companySettings=await client.query<{settings:unknown}>('SELECT settings FROM companies WHERE id=$1',[companyId]);
      const taxPolicy=readCompanyTaxPolicy(companySettings.rows[0]?.settings);
      let subtotal=0,taxAmount=0;
      const lines:Array<{description:string;qty:number;cost:number;rate:number;treatment:string;sub:number;tax:number;total:number;poItemId:string|null;receiptValue:number}>=[];
      for(const item of dto.items){
        if(dto.purchaseOrderId&&!item.purchaseOrderItemId)throw new BadRequestException('Each bill line must reference a received purchase order line when a purchase order is linked.');
        let receiptUnitCost = 0;
        if(item.purchaseOrderItemId){
          if(!dto.purchaseOrderId)throw new BadRequestException('A purchase order item requires a linked purchase order.');
          const poItem=await client.query<{id:string;product_name:string;unit_cost:string|number;purchase_order_id:string;quantity:string|number;received_quantity:string|number}>('SELECT id,product_name,unit_cost,purchase_order_id,quantity,received_quantity FROM purchase_order_items WHERE id=$1 AND company_id=$2 AND purchase_order_id=$3 FOR UPDATE',[item.purchaseOrderItemId,companyId,dto.purchaseOrderId]);
          if(!poItem.rows[0])throw new NotFoundException('Linked purchase order item not found.');
          receiptUnitCost = Number(poItem.rows[0].unit_cost);
          const billed=await client.query<{quantity:string|number}>("SELECT COALESCE(SUM(i.quantity),0) AS quantity FROM supplier_bill_items i JOIN supplier_bills b ON b.id=i.supplier_bill_id AND b.company_id=i.company_id WHERE i.company_id=$1 AND i.purchase_order_item_id=$2 AND b.status<>'void'",[companyId,item.purchaseOrderItemId]);
          const available=Number(poItem.rows[0].received_quantity)-Number(billed.rows[0].quantity);
          if(item.quantity>available+0.0000001)throw new BadRequestException(`Bill quantity exceeds received, not-yet-billed quantity for "${poItem.rows[0].product_name}" (available: ${Math.max(0,available)}).`);
        }
        const sub=Math.round(item.quantity*item.unitCost*100)/100;
        const taxConfig=resolveTaxTreatment({policy:taxPolicy,productTreatment:(item.taxTreatment??'legacy') as 'legacy'|'standard'|'zero_rated'|'exempt'|'out_of_scope',productRate:item.taxRate??0,requestedRate:item.taxRate});
        const tax=Math.round(sub*taxConfig.rate)/100;
        subtotal+=sub;taxAmount+=tax;
        lines.push({description:item.description.trim(),qty:item.quantity,cost:item.unitCost,rate:taxConfig.rate,treatment:taxConfig.treatment,sub,tax,total:sub+tax,poItemId:item.purchaseOrderItemId??null,receiptValue:Math.round(item.quantity*receiptUnitCost*100)/100});
      }
      if(subtotal+taxAmount<=0)throw new BadRequestException('Supplier bill total must be greater than zero to post to the ledger.');
      await this.accounting.ensureDefaults(companyId);
      const inserted=await client.query<{id:string}>(`INSERT INTO supplier_bills(company_id,supplier_id,purchase_order_id,bill_number,supplier_invoice_number,bill_date,due_date,status,subtotal,tax_amount,total,notes,created_by)
        VALUES($1,$2,$3,$4,$5,COALESCE($6::date,CURRENT_DATE),$7::date,'open',$8,$9,$10,$11,$12) RETURNING id`,
        [companyId,dto.supplierId,dto.purchaseOrderId??null,number,dto.supplierInvoiceNumber??null,dto.billDate??null,dto.dueDate??null,subtotal,taxAmount,subtotal+taxAmount,dto.notes??null,user.userId]);
      for(const line of lines)await client.query(`INSERT INTO supplier_bill_items(company_id,supplier_bill_id,purchase_order_item_id,description,quantity,unit_cost,tax_rate,tax_treatment,line_subtotal,tax_amount,line_total)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[companyId,inserted.rows[0].id,line.poItemId,line.description,line.qty,line.cost,line.rate,line.treatment,line.sub,line.tax,line.total]);
      const billId=inserted.rows[0].id;
      // Goods received through a purchase order increase inventory; standalone bills remain expense-coded.
      const receiptValue=lines.reduce((sum,line)=>sum+line.receiptValue,0);
      const standaloneSubtotal=lines.filter(line=>line.poItemId===null).reduce((sum,line)=>sum+line.sub,0);
      const priceVariance=subtotal-standaloneSubtotal-receiptValue;
      const journalLines:Array<{systemCode:string;debit:number;credit:number;description:string}>=[];
      if(receiptValue>0)journalLines.push({systemCode:'goods_received_not_invoiced',debit:receiptValue,credit:0,description:'Clear goods received not yet invoiced'});
      if(standaloneSubtotal>0)journalLines.push({systemCode:'purchases_expense',debit:standaloneSubtotal,credit:0,description:'Standalone supplier bill expense'});
      if(priceVariance>0)journalLines.push({systemCode:'purchases_expense',debit:priceVariance,credit:0,description:'Purchase price variance'});
      if(priceVariance<0)journalLines.push({systemCode:'purchases_expense',debit:0,credit:-priceVariance,description:'Purchase price variance credit'});
      if(taxAmount>0)journalLines.push({systemCode:'input_tax',debit:taxAmount,credit:0,description:'Recoverable input tax'});
      journalLines.push({systemCode:'accounts_payable',debit:0,credit:subtotal+taxAmount,description:'Supplier payable'});
      await this.postJournal(client,{companyId,date:dto.billDate??null,description:`Supplier bill ${number}`,sourceType:'supplier_bill',sourceId:billId,userId:user.userId,lines:journalLines});
      return billId;
    });
    } catch(error) {
      const databaseError=error as {code?:string;constraint?:string};
      if(databaseError.code==='23505' && databaseError.constraint==='supplier_bills_supplier_invoice_number_unique'){
        throw new ConflictException('This supplier invoice number has already been recorded for this supplier. Check the existing bill before creating another.');
      }
      throw error;
    }
    await this.audit.log({userId:user.userId,companyId,branchId:null,action:'supplier_bill.create',entityType:'supplier_bill',entityId:id,oldValues:null,newValues:{supplierId:dto.supplierId,purchaseOrderId:dto.purchaseOrderId??null},ipAddress:null});
    return this.getById(user,id);
  }
  async recordPayment(user:AuthenticatedUser,id:string,dto:RecordSupplierBillPaymentDto) {
    const m=await this.companyFor(user);this.assertCompanyWide(m);
    await this.db.transaction(async client=>{
      const res=await client.query<{total:string|number;paid_amount:string|number;status:string}>('SELECT total,paid_amount,status FROM supplier_bills WHERE id=$1 AND company_id=$2 FOR UPDATE',[id,m.companyId]);
      const bill=res.rows[0];if(!bill)throw new NotFoundException('Supplier bill not found.');
      if(bill.status==='void')throw new BadRequestException('A void bill cannot receive payments.');
      const balance=Number(bill.total)-Number(bill.paid_amount);
      if(dto.amount>balance+0.000001)throw new BadRequestException('Payment exceeds the outstanding bill balance.');
      await this.accounting.ensureDefaults(m.companyId);
      const payment=await client.query<{id:string}>(`INSERT INTO supplier_bill_payments(company_id,supplier_bill_id,amount,payment_date,method,reference,notes,created_by)
       VALUES($1,$2,$3,COALESCE($4::date,CURRENT_DATE),$5,$6,$7,$8) RETURNING id`,[m.companyId,id,dto.amount,dto.paymentDate??null,dto.method,dto.reference??null,dto.notes??null,user.userId]);
      const cashAccount=dto.method==='cash'?'cash':dto.method==='mpesa'?'mpesa':'bank';
      await this.postJournal(client,{companyId:m.companyId,date:dto.paymentDate??null,description:`Payment against supplier bill ${id}`,sourceType:'supplier_bill_payment',sourceId:payment.rows[0].id,userId:user.userId,lines:[
       {systemCode:'accounts_payable',debit:dto.amount,credit:0,description:'Reduce supplier payable'},
       {systemCode:cashAccount,debit:0,credit:dto.amount,description:`Payment by ${dto.method}`}
      ]});
      const paid=Number(bill.paid_amount)+dto.amount;
      const status=paid+0.000001>=Number(bill.total)?'paid':'partially_paid';
      await client.query('UPDATE supplier_bills SET paid_amount=$1,status=$2,updated_at=NOW() WHERE id=$3 AND company_id=$4',[paid,status,id,m.companyId]);
    });
    await this.audit.log({userId:user.userId,companyId:m.companyId,branchId:null,action:'supplier_bill.payment',entityType:'supplier_bill',entityId:id,oldValues:null,newValues:{amount:dto.amount,method:dto.method},ipAddress:null});
    return this.getById(user,id);
  }
}
