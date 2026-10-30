import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AccountingService } from '../accounting/accounting.service.js';
import type { PoolClient } from 'pg';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import { readCompanyTaxPolicy, resolveTaxTreatment } from '../tax/tax-policy.js';
import type { CreatePurchaseOrderDto, ReceivePurchaseOrderDto, UpdatePurchaseOrderStatusDto } from './dto/purchase-order.dto.js';

@Injectable()
export class PurchaseOrdersService {
  constructor(private readonly db: DatabaseService, private readonly memberships: MembershipsService, private readonly audit: AuditService, private readonly accounting: AccountingService) {}
  private async postReceiptJournal(client: PoolClient, input: { companyId: string; userId: string; orderNumber: string; orderId: string; receiptId: string; receiptValue: number }) {
    if (input.receiptValue <= 0) return;
    const year = new Date().getFullYear();
    const seq = await client.query<{ next_number: number }>(`INSERT INTO journal_entry_sequences(company_id,entry_year,next_number) VALUES($1,$2,1) ON CONFLICT(company_id,entry_year) DO UPDATE SET next_number=journal_entry_sequences.next_number+1 RETURNING next_number`, [input.companyId, year]);
    const number = `JE-${year}-${String(seq.rows[0].next_number).padStart(6, '0')}`;
    const entry = await client.query<{ id: string }>(`INSERT INTO journal_entries(company_id,entry_number,entry_date,description,source_type,source_id,goods_receipt_id,status,posted_at,posted_by) VALUES($1,$2,CURRENT_DATE,$3,'purchase_order_receipt',$4,$4,'posted',NOW(),$5) RETURNING id`, [input.companyId, number, `Goods received for ${input.orderNumber} (PO ${input.orderId}; receipt ${input.receiptId})`, input.receiptId, input.userId]);
    const accounts = await client.query<{ id: string; system_code: string }>(`SELECT id,system_code FROM chart_of_accounts WHERE company_id=$1 AND system_code IN ('inventory','goods_received_not_invoiced') AND is_active=true`, [input.companyId]);
    const inventory = accounts.rows.find(a => a.system_code === 'inventory');
    const grni = accounts.rows.find(a => a.system_code === 'goods_received_not_invoiced');
    if (!inventory || !grni) throw new BadRequestException('Inventory and goods-received-not-invoiced accounts must be active.');
    await client.query(`INSERT INTO journal_entry_lines(company_id,journal_entry_id,account_id,description,debit,credit) VALUES($1,$2,$3,'Goods received into inventory',$4,0),($1,$2,$5,'Goods received not yet invoiced',0,$4)`, [input.companyId, entry.rows[0].id, inventory.id, input.receiptValue, grni.id]);
  }
  private companyFor(user: AuthenticatedUser) {
    return user.companyId ? this.memberships.getMembershipForCompany(user.userId,user.companyId) : this.memberships.getMembership(user.userId);
  }
  private assertCompanyWideProcurement(membership: { branchId?: string | null }) {
    if (membership.branchId) throw new ForbiddenException('Purchase orders are company-wide until branch attribution is supported. A company-wide procurement administrator must perform this action.');
  }
  async list(user: AuthenticatedUser) {
    const membership=await this.companyFor(user); this.assertCompanyWideProcurement(membership); const {companyId}=membership;
    return (await this.db.query(
      `SELECT po.id,po.company_id,po.supplier_id,s.name AS supplier_name,po.order_number,po.order_date,po.expected_date,po.status,po.currency,po.subtotal,po.tax_amount,po.total,po.notes,po.created_at,po.updated_at,ar.status AS approval_status,COUNT(i.id)::int AS item_count,COALESCE(SUM(i.quantity),0) AS ordered_quantity,COALESCE(SUM(i.received_quantity),0) AS received_quantity
       FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id AND s.company_id=po.company_id
       LEFT JOIN purchase_order_items i ON i.purchase_order_id=po.id AND i.company_id=po.company_id
       LEFT JOIN approval_requests ar ON ar.company_id=po.company_id AND ar.entity_type='purchase_order' AND ar.entity_id=po.id
       WHERE po.company_id=$1 GROUP BY po.id,s.name,ar.status ORDER BY po.created_at DESC`,[companyId])).rows;
  }
  async getById(user: AuthenticatedUser,id: string) {
    const membership=await this.companyFor(user); this.assertCompanyWideProcurement(membership); const {companyId}=membership;
    const result=await this.db.query(`SELECT po.*,s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id AND s.company_id=po.company_id WHERE po.company_id=$1 AND po.id=$2`,[companyId,id]);
    if(!result.rows[0]) throw new NotFoundException('Purchase order not found.');
    const items=await this.db.query('SELECT * FROM purchase_order_items WHERE company_id=$1 AND purchase_order_id=$2 ORDER BY created_at,id',[companyId,id]);
    return {...result.rows[0],items:items.rows};
  }
  async create(user: AuthenticatedUser,dto: CreatePurchaseOrderDto) {
    const membership=await this.companyFor(user); this.assertCompanyWideProcurement(membership); const companyId=membership.companyId;
    const id=await this.db.transaction(async client=>{
      const supplier=await client.query("SELECT id FROM suppliers WHERE id=$1 AND company_id=$2 AND is_active=true AND status='active'",[dto.supplierId,companyId]);
      if(!supplier.rows[0]) throw new NotFoundException('Active supplier not found in this company.');
      const year=new Date().getFullYear();
      const seq=await client.query<{next_number:number}>(`INSERT INTO purchase_order_sequences(company_id,order_year,next_number) VALUES($1,$2,1) ON CONFLICT(company_id,order_year) DO UPDATE SET next_number=purchase_order_sequences.next_number+1 RETURNING next_number`,[companyId,year]);
      const number=`PO-${year}-${String(seq.rows[0].next_number).padStart(5,'0')}`;
      const companySettings = await client.query<{settings:unknown}>('SELECT settings FROM companies WHERE id=$1 AND is_active=true',[companyId]);
      if (!companySettings.rows[0]) throw new NotFoundException('Active company not found.');
      const taxPolicy = readCompanyTaxPolicy(companySettings.rows[0].settings);
      let subtotal=0,taxAmount=0;
      const lines:Array<{productId:string;name:string;sku:string;qty:number;cost:number;rate:number;sub:number;tax:number;total:number}>=[];
      for(const item of dto.items){
        const res=await client.query<{id:string;name:string;sku:string;is_service:boolean;is_active:boolean;tax_treatment:string;tax_rate:string|number}>(
          'SELECT id,name,sku,is_service,is_active,tax_treatment,tax_rate FROM products WHERE id=$1 AND company_id=$2 FOR SHARE',[item.productId,companyId]);
        const p=res.rows[0]; if(!p||!p.is_active) throw new NotFoundException('A selected product is missing or inactive in this company.');
        if(p.is_service) throw new BadRequestException(`Service item "${p.name}" cannot be received into inventory.`);
        const tax = resolveTaxTreatment({
          policy: taxPolicy,
          productTreatment: (p.tax_treatment ?? 'legacy') as 'legacy'|'standard'|'zero_rated'|'exempt'|'out_of_scope',
          productRate: Number(p.tax_rate ?? 0),
          requestedRate: item.taxRate,
        });
        const rate = tax.rate;
        const sub=Math.round(item.quantity*item.unitCost*100)/100; const taxAmountForLine=Math.round(sub*rate)/100;
        subtotal+=sub;taxAmount+=taxAmountForLine;lines.push({productId:p.id,name:p.name,sku:p.sku,qty:item.quantity,cost:item.unitCost,rate,sub,tax:taxAmountForLine,total:sub+taxAmountForLine});
      }
      const inserted=await client.query<{id:string}>(`INSERT INTO purchase_orders(company_id,supplier_id,order_number,expected_date,status,subtotal,tax_amount,total,notes,created_by) VALUES($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9) RETURNING id`,[companyId,dto.supplierId,number,dto.expectedDate??null,subtotal,taxAmount,subtotal+taxAmount,dto.notes??null,user.userId]);
      for(const l of lines) await client.query(`INSERT INTO purchase_order_items(company_id,purchase_order_id,product_id,product_name,sku,quantity,unit_cost,tax_rate,line_subtotal,tax_amount,line_total) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[companyId,inserted.rows[0].id,l.productId,l.name,l.sku,l.qty,l.cost,l.rate,l.sub,l.tax,l.total]);
      await this.audit.logInTransaction(client, {userId:user.userId,companyId,branchId:null,action:'purchase_order.create',entityType:'purchase_order',entityId:inserted.rows[0].id,oldValues:null,newValues:{supplierId:dto.supplierId},ipAddress:null});
      return inserted.rows[0].id;
    });
    return this.getById(user,id);
  }
  async updateStatus(user: AuthenticatedUser,id:string,dto:UpdatePurchaseOrderStatusDto) {
    const m=await this.companyFor(user); this.assertCompanyWideProcurement(m);
    const state=await this.db.transaction(async client=>{
      const res=await client.query<{status:string}>('SELECT status FROM purchase_orders WHERE id=$1 AND company_id=$2 FOR UPDATE',[id,m.companyId]);
      const row=res.rows[0];if(!row)throw new NotFoundException('Purchase order not found.');
      if(dto.status==='ordered'&&row.status==='draft') {
        const approval=await client.query("SELECT id FROM approval_requests WHERE company_id=$1 AND entity_type='purchase_order' AND entity_id=$2 AND status='approved'",[m.companyId,id]);
        if(!approval.rows[0]) throw new BadRequestException('Purchase orders must be approved before they can be ordered.');
        await client.query("UPDATE purchase_orders SET status='ordered',updated_at=NOW() WHERE id=$1 AND company_id=$2",[id,m.companyId]);
      }
      else if(dto.status==='cancelled'&&['draft','ordered'].includes(row.status)) {
        const pending=await client.query("SELECT id FROM approval_requests WHERE company_id=$1 AND entity_type='purchase_order' AND entity_id=$2 AND status='pending'",[m.companyId,id]);
        if(pending.rows[0]) throw new BadRequestException('A purchase order awaiting approval cannot be cancelled.');
        await client.query("UPDATE purchase_orders SET status='cancelled',updated_at=NOW() WHERE id=$1 AND company_id=$2",[id,m.companyId]);
      }
      else throw new BadRequestException(`Cannot change purchase order status from ${row.status} to ${dto.status}.`);
      await this.audit.logInTransaction(client, {userId:user.userId,companyId:m.companyId,branchId:null,action:'purchase_order.status_change',entityType:'purchase_order',entityId:id,oldValues:{status:row.status},newValues:{status:dto.status},ipAddress:null});
      return row.status;
    });
    return this.getById(user,id);
  }
  async listReceipts(user: AuthenticatedUser, id: string) {
    const membership = await this.companyFor(user);
    this.assertCompanyWideProcurement(membership);
    const { companyId } = membership;
    const order = await this.db.query(
      'SELECT id FROM purchase_orders WHERE id=$1 AND company_id=$2',
      [id, companyId],
    );
    if (!order.rows[0]) throw new NotFoundException('Purchase order not found.');
    const receipts = await this.db.query<{
      id: string; company_id: string; purchase_order_id: string; warehouse_id: string;
      warehouse_name: string; receipt_reference: string | null; notes: string | null;
      received_by: string | null; received_at: Date; receipt_value: string | number;
    }>(
      `SELECT gr.id,gr.company_id,gr.purchase_order_id,gr.warehouse_id,w.name AS warehouse_name,
              gr.receipt_reference,gr.notes,gr.received_by,gr.received_at,gr.receipt_value
       FROM goods_receipts gr
       JOIN warehouses w ON w.id=gr.warehouse_id AND w.company_id=gr.company_id
       WHERE gr.company_id=$1 AND gr.purchase_order_id=$2
       ORDER BY gr.received_at DESC,gr.id DESC`,
      [companyId, id],
    );
    const items = await this.db.query<{
      id: string; goods_receipt_id: string; purchase_order_item_id: string; product_id: string;
      product_name: string; quantity: string | number; unit_cost: string | number;
      line_value: string | number; created_at: Date;
    }>(
      `SELECT gri.id,gri.goods_receipt_id,gri.purchase_order_item_id,gri.product_id,
              p.name AS product_name,gri.quantity,gri.unit_cost,gri.line_value,gri.created_at
       FROM goods_receipt_items gri
       JOIN products p ON p.id=gri.product_id AND p.company_id=gri.company_id
       JOIN goods_receipts gr ON gr.id=gri.goods_receipt_id AND gr.company_id=gri.company_id
       WHERE gri.company_id=$1 AND gr.purchase_order_id=$2
       ORDER BY gri.created_at,gri.id`,
      [companyId, id],
    );
    const itemsByReceipt = new Map<string, typeof items.rows>();
    for (const item of items.rows) {
      const bucket = itemsByReceipt.get(item.goods_receipt_id) ?? [];
      bucket.push(item);
      itemsByReceipt.set(item.goods_receipt_id, bucket);
    }
    return receipts.rows.map(receipt => ({
      ...receipt,
      items: itemsByReceipt.get(receipt.id) ?? [],
    }));
  }

  async receive(user:AuthenticatedUser,id:string,dto:ReceivePurchaseOrderDto) {
    const m=await this.companyFor(user); this.assertCompanyWideProcurement(m);
    if (!dto.items?.length) throw new BadRequestException('Select at least one purchase order line to receive.');
    if (new Set(dto.items.map(item => item.itemId)).size !== dto.items.length) {
      throw new BadRequestException('Each purchase order line can only appear once per receipt.');
    }
    const receiptId = randomUUID();
    await this.db.transaction(async client=>{
      const res=await client.query<{id:string;order_number:string;status:string}>('SELECT id,order_number,status FROM purchase_orders WHERE id=$1 AND company_id=$2 FOR UPDATE',[id,m.companyId]);
      const po=res.rows[0];if(!po)throw new NotFoundException('Purchase order not found.');
      if(!['ordered','partially_received'].includes(po.status))throw new BadRequestException('Only ordered purchase orders can receive stock.');
      const wh=await client.query('SELECT id FROM warehouses WHERE id=$1 AND company_id=$2 AND is_active=true',[dto.warehouseId,m.companyId]);
      if(!wh.rows[0])throw new NotFoundException('Active warehouse not found in this company.');
      let receiptValue = 0;
      const planned: Array<{
        item: (typeof dto.items)[number];
        line: { id: string; product_id: string; quantity: string | number; received_quantity: string | number; unit_cost: string | number; product_name: string };
      }> = [];
      // Lock and validate every line before creating accounting defaults or changing stock.
      for (const r of dto.items) {
        const lineRes = await client.query<{
          id: string; product_id: string; quantity: string | number; received_quantity: string | number;
          unit_cost: string | number; product_name: string;
        }>(
          'SELECT id,product_id,quantity,received_quantity,unit_cost,product_name FROM purchase_order_items WHERE id=$1 AND purchase_order_id=$2 AND company_id=$3 FOR UPDATE',
          [r.itemId, id, m.companyId],
        );
        const line = lineRes.rows[0];
        if (!line) throw new NotFoundException('Purchase order line not found.');
        const product = await client.query<{ id: string; is_active: boolean; is_service: boolean }>(
          'SELECT id,is_active,is_service FROM products WHERE id=$1 AND company_id=$2 FOR SHARE',
          [line.product_id, m.companyId],
        );
        if (!product.rows[0] || !product.rows[0].is_active) {
          throw new NotFoundException('A selected product is missing or inactive in this company.');
        }
        if (product.rows[0].is_service) {
          throw new BadRequestException('Service items cannot be received into inventory.');
        }
        if (!Number.isFinite(r.quantity) || r.quantity <= 0) throw new BadRequestException('Receipt quantities must be positive.');
        if (r.quantity > Number(line.quantity) - Number(line.received_quantity) + 0.0000001) {
          throw new BadRequestException(`Receipt exceeds remaining quantity for "${line.product_name}".`);
        }
        receiptValue += Math.round(r.quantity * Number(line.unit_cost) * 100) / 100;
        planned.push({ item: r, line });
      }
      await client.query(
        `INSERT INTO goods_receipts(id,company_id,purchase_order_id,warehouse_id,receipt_reference,notes,received_by,receipt_value)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [receiptId, m.companyId, po.id, dto.warehouseId, dto.reference ?? null, dto.notes ?? null, user.userId, receiptValue],
      );
      await this.accounting.ensureDefaults(m.companyId, client);
      for (const { item: r, line } of planned) {
        await client.query(`INSERT INTO inventory_stock_levels(company_id,warehouse_id,product_id,quantity,reserved_quantity,reorder_level,average_unit_cost)
        SELECT $1,$2,$3,$4,0,p.reorder_level,$5 FROM products p WHERE p.id=$3 AND p.company_id=$1
        ON CONFLICT(warehouse_id,product_id) DO UPDATE SET
          average_unit_cost=CASE WHEN inventory_stock_levels.quantity+EXCLUDED.quantity>0
            THEN ((inventory_stock_levels.quantity*inventory_stock_levels.average_unit_cost)+(EXCLUDED.quantity*EXCLUDED.average_unit_cost))/(inventory_stock_levels.quantity+EXCLUDED.quantity)
            ELSE EXCLUDED.average_unit_cost END,
          quantity=inventory_stock_levels.quantity+EXCLUDED.quantity,updated_at=NOW()`,
          [m.companyId, dto.warehouseId, line.product_id, r.quantity, Number(line.unit_cost)]);
        await client.query(`INSERT INTO inventory_stock_movements(company_id,product_id,warehouse_id,movement_type,quantity,unit_cost,reference,notes,created_by)
          VALUES($1,$2,$3,'receipt',$4,$5,$6,$7,$8)`,
          [m.companyId, line.product_id, dto.warehouseId, r.quantity, Number(line.unit_cost), dto.reference ?? po.order_number, dto.notes ?? `Received against purchase order ${po.order_number}`, user.userId]);
        const lineValue = Math.round(r.quantity * Number(line.unit_cost) * 100) / 100;
        await client.query(
          `INSERT INTO goods_receipt_items(company_id,goods_receipt_id,purchase_order_item_id,product_id,quantity,unit_cost,line_value)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [m.companyId, receiptId, line.id, line.product_id, r.quantity, Number(line.unit_cost), lineValue],
        );
        await client.query('UPDATE purchase_order_items SET received_quantity=received_quantity+$1 WHERE id=$2 AND company_id=$3',
          [r.quantity, line.id, m.companyId]);
        await client.query('UPDATE products SET stock_quantity=(SELECT COALESCE(SUM(quantity),0) FROM inventory_stock_levels WHERE company_id=$1 AND product_id=$2),updated_at=NOW() WHERE id=$2 AND company_id=$1',
          [m.companyId, line.product_id]);
      }
      await this.postReceiptJournal(client, { companyId: m.companyId, userId: user.userId, orderNumber: po.order_number, orderId: po.id, receiptId, receiptValue });
      const sums=await client.query<{ordered:string|number;received:string|number}>('SELECT COALESCE(SUM(quantity),0) ordered,COALESCE(SUM(received_quantity),0) received FROM purchase_order_items WHERE purchase_order_id=$1 AND company_id=$2',[id,m.companyId]);
      const done=Number(sums.rows[0].ordered)>0&&Number(sums.rows[0].received)+0.0000001>=Number(sums.rows[0].ordered);
      await client.query('UPDATE purchase_orders SET status=$1,updated_at=NOW() WHERE id=$2 AND company_id=$3',[done?'received':'partially_received',id,m.companyId]);
      await this.audit.logInTransaction(client, {userId:user.userId,companyId:m.companyId,branchId:null,action:'purchase_order.receive',entityType:'purchase_order',entityId:id,oldValues:{status:po.status},newValues:{status:done?'received':'partially_received',warehouseId:dto.warehouseId,itemCount:dto.items.length,receiptId},ipAddress:null});
    });
    const receiptResult = await this.db.query(
      `SELECT id,company_id,purchase_order_id,warehouse_id,receipt_reference,notes,received_by,received_at,receipt_value
       FROM goods_receipts WHERE id=$1 AND company_id=$2 AND purchase_order_id=$3`,
      [receiptId, m.companyId, id],
    );
    const receiptItems = await this.db.query(
      `SELECT id,purchase_order_item_id,product_id,quantity,unit_cost,line_value,created_at
       FROM goods_receipt_items WHERE goods_receipt_id=$1 AND company_id=$2 ORDER BY created_at,id`,
      [receiptId, m.companyId],
    );
    return {
      ...await this.getById(user,id),
      receiptId,
      receipt: receiptResult.rows[0] ? {...receiptResult.rows[0], items: receiptItems.rows} : null,
    };
  }
}
