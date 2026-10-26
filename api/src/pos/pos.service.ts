import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import type { PoolClient } from 'pg';
import { AccountingService } from '../accounting/accounting.service.js';
import { readCompanyTaxPolicy, resolveTaxTreatment } from '../tax/tax-policy.js';
import { ProductImageStorageService } from '../products/product-image-storage.service.js';
import type { PosCheckoutDto } from './dto/pos-checkout.dto.js';

export function buildCogsJournalLines(costCents: number) {
  if (!Number.isSafeInteger(costCents) || costCents < 0) {
    throw new BadRequestException('Cost of goods must be a non-negative whole number of cents.');
  }
  const cost = costCents / 100;
  return costCents === 0 ? [] : [
    { systemCode: 'purchases_expense', debit: cost, credit: 0, description: 'Cost of goods sold' },
    { systemCode: 'inventory', debit: 0, credit: cost, description: 'Reduce inventory asset' },
  ];
}

type RegisterInput = { code: string; name: string; branchId?: string | null };
type OpenShiftInput = { registerId: string; openingFloat: number };
type CloseShiftInput = { countedCash: number; notes?: string };

@Injectable()
export class PosService {
  constructor(
    private readonly db: DatabaseService,
    private readonly memberships: MembershipsService,
    private readonly audit: AuditService,
    private readonly accounting: AccountingService,
    private readonly imageStorage: ProductImageStorageService,
  ) {}

  private async company(user: AuthenticatedUser) {
    return user.companyId
      ? this.memberships.getMembershipForCompany(user.userId, user.companyId)
      : this.memberships.getMembership(user.userId);
  }

  async listRegisters(user: AuthenticatedUser) {
    const membership = await this.company(user);
    const { companyId } = membership;
    const canViewTeam = user.permissions.includes('sales:team-read');
    const result = await this.db.query(
      `SELECT r.id,r.company_id,r.branch_id,r.code,r.name,r.is_active,r.created_at,
        b.name AS branch_name,
        s.id AS open_shift_id,s.opened_by,s.opening_float,s.opened_at
       FROM pos_registers r
       LEFT JOIN branches b ON b.id=r.branch_id AND b.company_id=r.company_id
       LEFT JOIN pos_shifts s ON s.register_id=r.id AND s.company_id=r.company_id AND s.status='open'
       WHERE r.company_id=$1
         AND ($4::uuid IS NULL OR r.branch_id=$4::uuid)
         AND (
           $2::boolean=true OR EXISTS (
             SELECT 1 FROM salesperson_stock_assignments a
             JOIN warehouses w ON w.id=a.warehouse_id AND w.company_id=a.company_id
             WHERE a.company_id=r.company_id AND a.user_id=$3 AND a.is_active=true
               AND r.branch_id IS NOT DISTINCT FROM w.branch_id
           )
         )
       ORDER BY r.is_active DESC,r.name ASC`,
      [companyId,canViewTeam,user.userId,membership.branchId??null],
    );
    return result.rows;
  }

  async createRegister(user: AuthenticatedUser, input: RegisterInput) {
    const membership = await this.company(user);
    const { companyId, branchId } = membership;
    if (branchId && input.branchId !== branchId) throw new ForbiddenException('You can only create POS registers for your assigned branch.');
    const code = input.code?.trim().toUpperCase();
    const name = input.name?.trim();
    if (!code || code.length > 32) throw new BadRequestException('Register code is required and must be at most 32 characters.');
    if (!name || name.length > 120) throw new BadRequestException('Register name is required and must be at most 120 characters.');
    if (input.branchId) {
      const branch = await this.db.query('SELECT id FROM branches WHERE id=$1 AND company_id=$2 AND is_active=true', [input.branchId, companyId]);
      if (!branch.rows[0]) throw new BadRequestException('Select an active branch belonging to this company.');
    }
    let register;
    try {
      const result = await this.db.query(
        `INSERT INTO pos_registers(company_id,branch_id,code,name)
         VALUES($1,$2,$3,$4)
         RETURNING id,company_id,branch_id,code,name,is_active,created_at`,
        [companyId, input.branchId ?? null, code, name],
      );
      register = result.rows[0];
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('A register with this code already exists in this company.');
      throw error;
    }
    await this.audit.log({
      userId:user.userId, companyId, branchId:input.branchId ?? null,
      action:'pos.register.create', entityType:'pos_register', entityId:String((register as {id:string}).id),
      oldValues:null, newValues:{code,name}, ipAddress:null,
    });
    return register;
  }

  async currentShift(user: AuthenticatedUser) {
    const membership = await this.company(user);
    const { companyId, branchId } = membership;
    const result = await this.db.query(
      `SELECT s.*,r.code AS register_code,r.name AS register_name
       FROM pos_shifts s JOIN pos_registers r ON r.id=s.register_id AND r.company_id=s.company_id
       WHERE s.company_id=$1 AND s.status='open' AND s.opened_by=$2
         AND ($3::uuid IS NULL OR r.branch_id=$3::uuid)
       ORDER BY s.opened_at DESC LIMIT 1`,
      [companyId, user.userId, branchId ?? null],
    );
    return result.rows[0] ?? null;
  }


  private async postJournal(client: PoolClient, input: {
    companyId:string; userId:string; date:string; description:string; sourceType:string; sourceId:string;
    lines:Array<{systemCode:string;debit:number;credit:number;description:string}>;
  }) {
    const year=Number(input.date.slice(0,4));
    const seq=await client.query<{next_number:number}>(
      `INSERT INTO journal_entry_sequences(company_id,entry_year,next_number) VALUES($1,$2,1)
       ON CONFLICT(company_id,entry_year) DO UPDATE SET next_number=journal_entry_sequences.next_number+1
       RETURNING next_number`,[input.companyId,year]);
    const entryNumber=`JE-${year}-${String(seq.rows[0].next_number).padStart(6,'0')}`;
    const entry=await client.query<{id:string}>(
      `INSERT INTO journal_entries(company_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by)
       VALUES($1,$2,$3,$4,$5,$6,'posted',NOW(),$7) RETURNING id`,
      [input.companyId,entryNumber,input.date,input.description,input.sourceType,input.sourceId,input.userId]);
    let debits=0,credits=0;
    for(const line of input.lines) {
      if(line.debit<=0&&line.credit<=0) continue;
      const account=await client.query<{id:string}>(
        'SELECT id FROM chart_of_accounts WHERE company_id=$1 AND system_code=$2 AND is_active=true',
        [input.companyId,line.systemCode]);
      if(!account.rows[0]) throw new BadRequestException(`Required accounting account "${line.systemCode}" is missing or inactive.`);
      await client.query(
        'INSERT INTO journal_entry_lines(company_id,journal_entry_id,account_id,description,debit,credit) VALUES($1,$2,$3,$4,$5,$6)',
        [input.companyId,entry.rows[0].id,account.rows[0].id,line.description,line.debit,line.credit]);
      debits+=line.debit; credits+=line.credit;
    }
    if(Math.abs(debits-credits)>0.005||debits<=0) throw new BadRequestException('POS accounting journal is not balanced.');
  }

  async mySalespersonAssignment(user: AuthenticatedUser) {
    const {companyId}=await this.company(user);
    const r=await this.db.query(`SELECT a.id,a.user_id,a.warehouse_id,a.is_active,u.full_name AS salesperson_name,u.email AS salesperson_email,w.code AS warehouse_code,w.name AS warehouse_name FROM salesperson_stock_assignments a JOIN users u ON u.id=a.user_id JOIN warehouses w ON w.id=a.warehouse_id AND w.company_id=a.company_id WHERE a.company_id=$1 AND a.user_id=$2 AND a.is_active=true LIMIT 1`,[companyId,user.userId]);
    return r.rows[0]??null;
  }
  async listSalespersonAssignments(user: AuthenticatedUser) {
    const {companyId,branchId}=await this.company(user);
    return (await this.db.query(`SELECT a.id,a.user_id,a.warehouse_id,a.is_active,u.full_name AS salesperson_name,u.email AS salesperson_email,w.code AS warehouse_code,w.name AS warehouse_name FROM salesperson_stock_assignments a JOIN users u ON u.id=a.user_id JOIN warehouses w ON w.id=a.warehouse_id AND w.company_id=a.company_id WHERE a.company_id=$1 AND ($2::uuid IS NULL OR w.branch_id=$2::uuid) ORDER BY a.is_active DESC,u.full_name`,[companyId,branchId??null])).rows;
  }
  async assignSalespersonWarehouse(user: AuthenticatedUser,input:{userId:string;warehouseId:string}) {
    const membership = await this.company(user);
    const {companyId,branchId}=membership;
    if(!input.userId||!input.warehouseId||input.userId===user.userId) throw new BadRequestException('Choose a salesperson and warehouse.');
    const saved=await this.db.transaction(async client=>{
      const m=await client.query<{user_id:string;branch_id:string|null}>(`SELECT m.user_id,m.branch_id FROM company_memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=$1 AND m.user_id=$2 AND m.is_active=true AND u.is_active=true AND m.role IN ('staff','salesperson') FOR SHARE`,[companyId,input.userId]);
      if(!m.rows[0]) throw new BadRequestException('Salesperson must be active staff in this company.');
      if(branchId && m.rows[0].branch_id!==branchId) throw new ForbiddenException('You can only assign salespeople within your assigned branch.');
      const w=await client.query<{id:string;branch_id:string|null}>('SELECT id,branch_id FROM warehouses WHERE id=$1 AND company_id=$2 AND is_active=true FOR SHARE',[input.warehouseId,companyId]);
      if(!w.rows[0]) throw new BadRequestException('Choose an active warehouse belonging to this company.');
      if(branchId && w.rows[0].branch_id!==branchId) throw new ForbiddenException('You can only assign warehouses within your assigned branch.');
      const duplicate=await client.query('SELECT user_id FROM salesperson_stock_assignments WHERE company_id=$1 AND warehouse_id=$2 AND is_active=true AND user_id<>$3 FOR UPDATE',[companyId,input.warehouseId,input.userId]);
      if(duplicate.rows[0]) throw new BadRequestException('Warehouse already assigned to another salesperson.');
      return (await client.query(`INSERT INTO salesperson_stock_assignments(company_id,user_id,warehouse_id,assigned_by,is_active) VALUES($1,$2,$3,$4,true) ON CONFLICT(company_id,user_id) DO UPDATE SET warehouse_id=EXCLUDED.warehouse_id,assigned_by=EXCLUDED.assigned_by,is_active=true,updated_at=NOW() RETURNING id,user_id,warehouse_id,is_active`,[companyId,input.userId,input.warehouseId,user.userId])).rows[0];
    });
    await this.audit.log({userId:user.userId,companyId,branchId:null,action:'salesperson_stock.assign',entityType:'salesperson_stock_assignment',entityId:String(saved.id),oldValues:null,newValues:{userId:input.userId,warehouseId:input.warehouseId},ipAddress:null});
    return saved;
  }
  async searchProducts(user:AuthenticatedUser, search?:string, warehouseId?:string) {
    const {companyId}=await this.company(user);
    if(!user.permissions.includes('sales:team-read')) {
      const a=await this.db.query<{warehouse_id:string}>('SELECT warehouse_id FROM salesperson_stock_assignments WHERE company_id=$1 AND user_id=$2 AND is_active=true LIMIT 1',[companyId,user.userId]);
      if(!a.rows[0]) throw new BadRequestException('Your manager must assign a stock warehouse before selling.');
      if(warehouseId&&warehouseId!==a.rows[0].warehouse_id) throw new BadRequestException('You can only sell from your assigned warehouse.');
      warehouseId=a.rows[0].warehouse_id;
    }
    const term=search?.trim();
    const result=await this.db.query(
      `SELECT p.id,p.sku,p.name,p.unit,p.selling_price,p.cost_price,p.is_service,p.image_url,p.image_storage_key,
        COALESCE(SUM(s.quantity-s.reserved_quantity),0)::numeric(16,3) AS available_quantity
       FROM products p
       LEFT JOIN inventory_stock_levels s ON s.product_id=p.id AND s.company_id=p.company_id
         AND ($2::uuid IS NULL OR s.warehouse_id=$2::uuid)
       WHERE p.company_id=$1 AND p.is_active=true
         AND ($3::text IS NULL OR p.name ILIKE $3 OR p.sku ILIKE $3)
       GROUP BY p.id ORDER BY p.name LIMIT 100`,
      [companyId,warehouseId??null,term?`%${term}%`:null]);
    return result.rows.map((row: Record<string, unknown>) => {
      const { image_storage_key: storageKey, ...product } = row;
      const salespersonSafeProduct = Object.fromEntries(Object.entries(product).filter(([key]) => key !== 'cost_price'));
      const visibleProduct = user.permissions.includes('sales:team-read') ? product : salespersonSafeProduct;
      return { ...visibleProduct, image_url: storageKey ? this.imageStorage.signedReadUrl(String(storageKey)) : product.image_url };
    });
  }

  async checkout(user:AuthenticatedUser,dto:PosCheckoutDto) {
    const membership=await this.company(user);
    const {companyId,branchId}=membership;
    await this.accounting.ensureDefaults(companyId);
    const today=new Date().toISOString().slice(0,10);
    const totals=await this.db.transaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[dto.requestId]);
      const prior=await client.query<{id:string;sale_number:string;total:string|number;subtotal:string|number;tax_amount:string|number;amount_confirmed:string|number;status:string;invoice_id:string;created_by:string|null}>(
        'SELECT id,sale_number,total,subtotal,tax_amount,amount_confirmed,status,invoice_id,created_by FROM pos_sales WHERE company_id=$1 AND request_id=$2',
        [companyId,dto.requestId]);
      if(prior.rows[0]) {
        const p=prior.rows[0];
        if(p.created_by!==user.userId) throw new ConflictException('This checkout request key has already been used.');
        return {saleId:p.id,invoiceId:p.invoice_id,saleNumber:p.sale_number,total:Number(p.total),subtotal:Number(p.subtotal),taxAmount:Number(p.tax_amount),amountConfirmed:Number(p.amount_confirmed),pendingPayment:Math.max(0,Number(p.total)-Number(p.amount_confirmed)),status:p.status,idempotent:true};
      }
      const shiftResult=await client.query<{id:string;register_id:string;opened_by:string;status:string}>(
        'SELECT id,register_id,opened_by,status FROM pos_shifts WHERE id=$1 AND company_id=$2 FOR UPDATE',
        [dto.shiftId,companyId]);
      const shift=shiftResult.rows[0];
      if(!shift||shift.status!=='open'||shift.opened_by!==user.userId) throw new BadRequestException('An open cashier shift belonging to you is required to check out.');
      const register=await client.query<{id:string;branch_id:string|null}>(
        'SELECT id,branch_id FROM pos_registers WHERE id=$1 AND company_id=$2 AND is_active=true',
        [shift.register_id,companyId]);
      if(!register.rows[0]) throw new BadRequestException('The shift register is no longer active.');
      if(branchId && register.rows[0].branch_id!==branchId) throw new ForbiddenException('Your selected branch does not have access to this POS register.');
      const warehouse=await client.query<{id:string;branch_id:string|null}>(
        'SELECT id,branch_id FROM warehouses WHERE id=$1 AND company_id=$2 AND is_active=true',
        [dto.warehouseId,companyId]);
      if(!warehouse.rows[0]) throw new BadRequestException('Choose an active warehouse belonging to this company.');
      if(!user.permissions.includes('sales:team-read') && warehouse.rows[0].branch_id !== register.rows[0].branch_id) {
        throw new BadRequestException('Your assigned warehouse and POS register must belong to the same branch.');
      }
      if(!user.permissions.includes('sales:team-read')) {
        const a=await client.query<{warehouse_id:string}>('SELECT warehouse_id FROM salesperson_stock_assignments WHERE company_id=$1 AND user_id=$2 AND is_active=true LIMIT 1 FOR SHARE',[companyId,user.userId]);
        if(!a.rows[0]) throw new BadRequestException('Your manager must assign a stock warehouse before selling.');
        if(a.rows[0].warehouse_id!==dto.warehouseId) throw new BadRequestException('You can only sell from your assigned warehouse.');
      }
      let customerId=dto.customerId;
      if(customerId) {
        const customer=await client.query<{id:string}>(
          "SELECT id FROM customers WHERE id=$1 AND company_id=$2 AND is_active=true AND status='active' FOR SHARE",
          [customerId,companyId]);
        if(!customer.rows[0]) throw new BadRequestException('Choose an active customer from your company.');
      } else {
        const walkIn=await client.query<{id:string}>(
          "SELECT id FROM customers WHERE company_id=$1 AND is_active=true AND name='Walk-in Customer' ORDER BY created_at LIMIT 1",
          [companyId]);
        customerId=walkIn.rows[0]?.id;
        if(!customerId) {
          const inserted=await client.query<{id:string}>(
            "INSERT INTO customers(company_id,name,status,is_active) VALUES($1,'Walk-in Customer','active',true) RETURNING id",
            [companyId]);
          customerId=inserted.rows[0].id;
        }
      }

      const companySettings=await client.query<{settings:unknown}>('SELECT settings FROM companies WHERE id=$1',[companyId]);
      const taxPolicy=readCompanyTaxPolicy(companySettings.rows[0]?.settings);
      const resolved:Array<{productId:string;name:string;sku:string;quantity:number;unitPrice:number;taxRate:number;taxTreatment:string;subtotal:number;tax:number;total:number;cost:number;isService:boolean}>=[];
      let subtotalCents=0,taxCents=0;
      for(const item of dto.items) {
        const productResult=await client.query<{id:string;name:string;sku:string;selling_price:string|number;cost_price:string|number;is_active:boolean;is_service:boolean;tax_treatment:string;tax_rate:string|number}>(
          'SELECT id,name,sku,selling_price,cost_price,is_active,is_service,tax_treatment,tax_rate FROM products WHERE id=$1 AND company_id=$2 FOR SHARE',
          [item.productId,companyId]);
        const p=productResult.rows[0];
        if(!p||!p.is_active) throw new BadRequestException('Every checkout item must be an active product from this company.');
        if(!Number.isFinite(item.quantity)||item.quantity<=0||Math.round(item.quantity*1000)!==item.quantity*1000) throw new BadRequestException('Product quantities must be positive with at most three decimal places.');
        const requestedUnitPrice=Number(item.unitPrice??p.selling_price);
        if(!user.permissions.includes('sales:team-read')&&requestedUnitPrice<Number(p.selling_price)) throw new BadRequestException('Salespeople cannot sell below the standard selling price.');
        const unitPriceCents=Math.round(requestedUnitPrice*100);
        const qtyMilli=Math.round(item.quantity*1000);
        const lineSubtotal=Math.round(unitPriceCents*qtyMilli/1000);
        const tax=resolveTaxTreatment({policy:taxPolicy,productTreatment:p.tax_treatment as 'legacy'|'standard'|'zero_rated'|'exempt'|'out_of_scope',productRate:Number(p.tax_rate),requestedRate:item.taxRate});
        const taxRate=tax.rate;
        const lineTax=Math.round(lineSubtotal*taxRate/100);
        subtotalCents+=lineSubtotal; taxCents+=lineTax;
        resolved.push({productId:p.id,name:p.name,sku:p.sku,quantity:qtyMilli/1000,unitPrice:unitPriceCents/100,taxRate,taxTreatment:tax.treatment,subtotal:lineSubtotal/100,tax:lineTax/100,total:(lineSubtotal+lineTax)/100,cost:Number(p.cost_price),isService:p.is_service});
      }
      const totalCents=subtotalCents+taxCents;
      const total=totalCents/100;
      if(totalCents<=0) throw new BadRequestException('A POS sale total must be greater than zero.');
      const payments=dto.payments.map(p=>({...p,cents:Math.round(Number(p.amount)*100)}));
      if(payments.some(p=>!Number.isFinite(p.cents)||p.cents<=0||Math.round(Number(p.amount)*100)!==Number(p.amount)*100)) throw new BadRequestException('Payment amounts must be positive and limited to two decimal places.');
      if(payments.reduce((sum,p)=>sum+p.cents,0)!==totalCents) throw new BadRequestException('Payment split must equal the exact checkout total.');
      if(payments.some(p=>p.method==='mpesa'&&!p.reference?.trim())) throw new BadRequestException('An M-Pesa transaction reference is required; the payment remains pending verification.');
      const confirmedCents=payments.filter(p=>p.method==='cash').reduce((sum,p)=>sum+p.cents,0);
      const pendingCents=totalCents-confirmedCents;
      const invoiceSequence=await client.query<{next_number:number}>(
        `INSERT INTO invoice_sequences(company_id,invoice_year,next_number) VALUES($1,$2,1)
         ON CONFLICT(company_id,invoice_year) DO UPDATE SET next_number=invoice_sequences.next_number+1 RETURNING next_number`,
        [companyId,Number(today.slice(0,4))]);
      const saleNumber=`POS-${today.slice(0,4)}-${String(invoiceSequence.rows[0].next_number).padStart(5,'0')}`;
      const invoiceStatus=confirmedCents>=totalCents?'paid':confirmedCents>0?'partially_paid':'sent';
      const invoiceResult=await client.query<{id:string;invoice_number:string}>(
        `INSERT INTO invoices(company_id,customer_id,invoice_number,issue_date,due_date,status,currency,subtotal,tax_amount,total,amount_paid,notes,created_by)
         VALUES($1,$2,$3,$4,$4,$5,'KES',$6,$7,$8,$9,$10,$11) RETURNING id,invoice_number`,
        [companyId,customerId,saleNumber,today,invoiceStatus,subtotalCents/100,taxCents/100,total,confirmedCents/100,dto.notes?.trim()||'POS sale',user.userId]);
      const invoiceId=invoiceResult.rows[0].id;
      let costCents=0;
      for(const line of resolved) {
        await client.query(
          `INSERT INTO invoice_items(company_id,invoice_id,product_id,product_name,sku,quantity,unit_price,tax_rate,tax_treatment,line_subtotal,tax_amount,line_total)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [companyId,invoiceId,line.productId,line.name,line.sku,line.quantity,line.unitPrice,line.taxRate,line.taxTreatment,line.subtotal,line.tax,line.total]);
        if(line.isService) continue;
        const stockResult=await client.query<{quantity:string|number;reserved_quantity:string|number}>(
          'SELECT quantity,reserved_quantity FROM inventory_stock_levels WHERE company_id=$1 AND warehouse_id=$2 AND product_id=$3 FOR UPDATE',
          [companyId,dto.warehouseId,line.productId]);
        const stock=stockResult.rows[0];
        if(!stock||Number(stock.quantity)-Number(stock.reserved_quantity)<line.quantity) {
          throw new BadRequestException(`Insufficient available stock for ${line.name}. Available: ${stock?Number(stock.quantity)-Number(stock.reserved_quantity):0}; required: ${line.quantity}.`);
        }
        await client.query('UPDATE inventory_stock_levels SET quantity=quantity-$1,updated_at=NOW() WHERE company_id=$2 AND warehouse_id=$3 AND product_id=$4',[line.quantity,companyId,dto.warehouseId,line.productId]);
        await client.query(
          `INSERT INTO inventory_stock_movements(company_id,product_id,warehouse_id,movement_type,quantity,unit_cost,reference,notes,created_by)
           VALUES($1,$2,$3,'issue',$4,$5,$6,'POS checkout stock issue',$7)`,
          [companyId,line.productId,dto.warehouseId,-line.quantity,line.cost,saleNumber,user.userId]);
        await client.query(
          `UPDATE products SET stock_quantity=COALESCE((SELECT SUM(quantity) FROM inventory_stock_levels WHERE company_id=$1 AND product_id=$2),0),updated_at=NOW()
           WHERE company_id=$1 AND id=$2`,[companyId,line.productId]);
        costCents+=Math.round(line.quantity*line.cost*100);
      }
      const sale=await client.query<{id:string}>(
        `INSERT INTO pos_sales(company_id,shift_id,register_id,warehouse_id,invoice_id,sale_number,request_id,subtotal,tax_amount,total,amount_confirmed,status,notes,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [companyId,dto.shiftId,shift.register_id,dto.warehouseId,invoiceId,saleNumber,dto.requestId,subtotalCents/100,taxCents/100,total,confirmedCents/100,pendingCents?'awaiting_payment_confirmation':'completed',dto.notes?.trim()||null,user.userId]);
      await this.postJournal(client,{companyId,userId:user.userId,date:today,description:`POS sale ${saleNumber}`,sourceType:'invoice',sourceId:invoiceId,lines:[
        {systemCode:'accounts_receivable',debit:total,credit:0,description:'POS customer receivable'},
        {systemCode:'sales_revenue',debit:subtotalCents/100,credit:0,description:'POS sales revenue'},
        {systemCode:'output_tax',debit:taxCents/100,credit:0,description:'POS output tax'},
      ].map(l=>l.systemCode==='sales_revenue'?{...l,debit:0,credit:subtotalCents/100}:l.systemCode==='output_tax'?{...l,debit:0,credit:taxCents/100}:l)});
      const cogsLines=buildCogsJournalLines(costCents);
      if(cogsLines.length>0) await this.postJournal(client,{companyId,userId:user.userId,date:today,description:`POS cost of goods sold ${saleNumber}`,sourceType:'invoice_cogs',sourceId:invoiceId,lines:cogsLines});
      await client.query('UPDATE customers SET outstanding_balance=outstanding_balance+$1,updated_at=NOW() WHERE id=$2 AND company_id=$3',[total,customerId,companyId]);
      for(const p of payments) {
        const isCash=p.method==='cash';
        const inserted=await client.query<{id:string}>(
          `INSERT INTO invoice_payments(company_id,invoice_id,amount,method,reference,notes,created_by,status,verified_at,verified_by,pos_shift_id)
           VALUES($1,$2,$3,$4,$5,$6,$7::uuid,$8::text,CASE WHEN $8::text='confirmed' THEN NOW() ELSE NULL END,CASE WHEN $8::text='confirmed' THEN $7::uuid ELSE NULL END,$9::uuid) RETURNING id`,
          [companyId,invoiceId,p.cents/100,p.method,p.reference?.trim()||null,`POS shift ${dto.shiftId}`,user.userId,isCash?'confirmed':'pending',dto.shiftId]);
        if(isCash) {
          await this.postJournal(client,{companyId,userId:user.userId,date:today,description:`POS cash receipt ${saleNumber}`,sourceType:'invoice_payment',sourceId:inserted.rows[0].id,lines:[
            {systemCode:'cash',debit:p.cents/100,credit:0,description:'POS cash received'},
            {systemCode:'accounts_receivable',debit:0,credit:p.cents/100,description:'Reduce customer receivable'}]});
        }
      }
      await client.query('UPDATE customers SET outstanding_balance=GREATEST(0,outstanding_balance-$1),updated_at=NOW() WHERE id=$2 AND company_id=$3',[confirmedCents/100,customerId,companyId]);
      return {saleId:sale.rows[0].id,invoiceId, saleNumber,total,subtotal:subtotalCents/100,taxAmount:taxCents/100,amountConfirmed:confirmedCents/100,pendingPayment:pendingCents/100,status:pendingCents?'awaiting_payment_confirmation':'completed'};
    });
    if(!('idempotent' in totals)) await this.audit.log({userId:user.userId,companyId,branchId:null,action:'pos.sale.checkout',entityType:'pos_sale',entityId:totals.saleId,oldValues:null,newValues:totals,ipAddress:null});
    return totals;
  }

  async listSales(user:AuthenticatedUser,limit?:string) {
    const membership=await this.company(user);
    const {companyId}=membership;
    const parsed=Number.parseInt(limit??'50',10);
    const safeLimit=Number.isFinite(parsed)?Math.max(1,Math.min(parsed,100)):50;
    const canViewTeam=user.permissions.includes('sales:team-read');
    // Company-wide POS history is only visible with the explicit team-read permission.
    return (await this.db.query(
      `SELECT s.id,s.sale_number,s.shift_id,s.register_id,s.warehouse_id,s.invoice_id,s.subtotal,s.tax_amount,s.total,s.amount_confirmed,s.status,s.created_at,
        i.invoice_number,i.status AS invoice_status,c.name AS customer_name
       FROM pos_sales s JOIN invoices i ON i.id=s.invoice_id AND i.company_id=s.company_id
       JOIN customers c ON c.id=i.customer_id AND c.company_id=i.company_id
       JOIN pos_registers r ON r.id=s.register_id AND r.company_id=s.company_id
       WHERE s.company_id=$1 AND ($5::uuid IS NULL OR r.branch_id=$5::uuid)
         AND ($3::boolean=true OR s.created_by=$4)
       ORDER BY s.created_at DESC LIMIT $2`,[companyId,safeLimit,canViewTeam,user.userId,membership.branchId??null])).rows;
  }

  async openShift(user: AuthenticatedUser, input: OpenShiftInput) {
    const membership = await this.company(user);
    const { companyId, branchId } = membership;
    const openingFloat = Number(input.openingFloat);
    if (!input.registerId || !Number.isFinite(openingFloat) || openingFloat < 0 || Math.round(openingFloat * 100) !== openingFloat * 100) {
      throw new BadRequestException('Choose a register and enter a non-negative opening float with at most two decimal places.');
    }
    let shift;
    try {
      shift = await this.db.transaction(async (client) => {
        const register = await client.query<{id:string;branch_id:string|null}>(
          'SELECT id,branch_id FROM pos_registers WHERE id=$1 AND company_id=$2 AND is_active=true FOR UPDATE',
          [input.registerId, companyId],
        );
        if (!register.rows[0]) throw new NotFoundException('Active POS register not found in this company.');
        if (branchId && register.rows[0].branch_id !== branchId) throw new ForbiddenException('Your selected branch does not have access to this POS register.');
        if (!user.permissions.includes('sales:team-read')) {
          const assignment = await client.query<{branch_id:string|null}>(
            `SELECT w.branch_id FROM salesperson_stock_assignments a
             JOIN warehouses w ON w.id=a.warehouse_id AND w.company_id=a.company_id
             WHERE a.company_id=$1 AND a.user_id=$2 AND a.is_active=true FOR SHARE`,
            [companyId,user.userId],
          );
          if (!assignment.rows[0]) throw new BadRequestException('Your manager must assign a stock warehouse before selling.');
          if (assignment.rows[0].branch_id !== register.rows[0].branch_id) {
            throw new BadRequestException('You can only open a register in your assigned warehouse branch.');
          }
        }
        const alreadyOpen = await client.query<{id:string}>(
          "SELECT id FROM pos_shifts WHERE register_id=$1 AND company_id=$2 AND status='open' FOR UPDATE",
          [input.registerId, companyId],
        );
        if (alreadyOpen.rows[0]) throw new ConflictException('This register already has an open cashier shift.');
        const inserted = await client.query(
          `INSERT INTO pos_shifts(company_id,register_id,opened_by,opening_float)
           VALUES($1,$2,$3,$4) RETURNING *`,
          [companyId,input.registerId,user.userId,openingFloat],
        );
        return inserted.rows[0];
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('This cashier or register already has an open shift.');
      throw error;
    }
    await this.audit.log({
      userId:user.userId, companyId, branchId:null, action:'pos.shift.open',
      entityType:'pos_shift', entityId:String((shift as {id:string}).id), oldValues:null,
      newValues:{registerId:input.registerId,openingFloat}, ipAddress:null,
    });
    return shift;
  }

  async closeShift(user: AuthenticatedUser, shiftId: string, input: CloseShiftInput) {
    const membership = await this.company(user);
    const { companyId, branchId } = membership;
    const countedCash = Number(input.countedCash);
    if (!Number.isFinite(countedCash) || countedCash < 0 || Math.round(countedCash * 100) !== countedCash * 100) {
      throw new BadRequestException('Counted cash must be non-negative with at most two decimal places.');
    }
    const shift = await this.db.transaction(async (client) => {
      const result = await client.query<{id:string;opened_by:string;opening_float:string|number;status:string;register_id:string;branch_id:string|null}>(
        `SELECT s.id,s.opened_by,s.opening_float,s.status,s.register_id,r.branch_id
         FROM pos_shifts s JOIN pos_registers r ON r.id=s.register_id AND r.company_id=s.company_id
         WHERE s.id=$1 AND s.company_id=$2 FOR UPDATE OF s`,
        [shiftId,companyId],
      );
      const existing = result.rows[0];
      if (!existing) throw new NotFoundException('POS shift not found.');
      if (branchId && existing.branch_id !== branchId) throw new ForbiddenException('Your selected branch does not have access to this POS shift.');
      if (existing.status !== 'open') throw new ConflictException('This shift is already closed.');
      if (existing.opened_by !== user.userId) throw new ConflictException('Only the cashier who opened this shift may close it.');
      const cash = await client.query<{total:string|number}>(
        `SELECT COALESCE(SUM(amount),0) AS total FROM invoice_payments
         WHERE company_id=$1 AND pos_shift_id=$2 AND status IN ('confirmed','reconciled') AND method='cash'`,
        [companyId,shiftId],
      );
      const expectedCash = Math.round((Number(existing.opening_float)+Number(cash.rows[0]?.total ?? 0))*100)/100;
      const difference = Math.round((countedCash-expectedCash)*100)/100;
      const updated = await client.query(
        `UPDATE pos_shifts SET status='closed',closed_by=$3,closed_at=NOW(),
          expected_cash=$4,counted_cash=$5,cash_difference=$6,notes=$7
         WHERE id=$1 AND company_id=$2 AND status='open' RETURNING *`,
        [shiftId,companyId,user.userId,expectedCash,countedCash,difference,input.notes?.trim() || null],
      );
      return updated.rows[0];
    });
    await this.audit.log({
      userId:user.userId, companyId, branchId:null, action:'pos.shift.close',
      entityType:'pos_shift', entityId:shiftId, oldValues:{status:'open'},
      newValues:{status:'closed',countedCash,expectedCash:(shift as {expected_cash:number|string}).expected_cash,cashDifference:(shift as {cash_difference:number|string}).cash_difference},
      ipAddress:null,
    });
    return shift;
  }
}
