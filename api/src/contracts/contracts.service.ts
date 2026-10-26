import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

@Injectable()
export class ContractsService {
  constructor(private readonly db: DatabaseService, private readonly memberships: MembershipsService, private readonly audit: AuditService) {}
  private async companyFor(user: AuthenticatedUser) { return user.companyId ? this.memberships.getMembershipForCompany(user.userId, user.companyId) : this.memberships.getMembership(user.userId); }
  private async scoped(user: AuthenticatedUser, id: string) {
    const m = await this.companyFor(user);
    const r = await this.db.query('SELECT * FROM contracts WHERE company_id=$1 AND id=$2 AND ($3::uuid IS NULL OR branch_id IS NULL OR branch_id=$3)', [m.companyId, id, m.branchId]);
    if (!r.rows[0]) throw new NotFoundException('Contract not found.');
    return { membership: m, row: r.rows[0] };
  }
  private assertBranchWritable(membership: { branchId?: string | null }, row: Record<string, unknown>) {
    if (membership.branchId && !row.branch_id) {
      throw new ForbiddenException('Branch-bound members can view company-wide contracts but cannot modify them.');
    }
  }
  async list(user: AuthenticatedUser) {
    const m = await this.companyFor(user);
    return (await this.db.query(`SELECT c.*, COALESCE(ci.item_count,0)::int AS item_count,
      COALESCE(co.open_obligations,0)::int AS open_obligations
      FROM contracts c
      LEFT JOIN LATERAL (SELECT COUNT(*) AS item_count FROM contract_items i WHERE i.company_id=c.company_id AND i.contract_id=c.id) ci ON true
      LEFT JOIN LATERAL (SELECT COUNT(*) AS open_obligations FROM contract_obligations o WHERE o.company_id=c.company_id AND o.contract_id=c.id AND o.status='open') co ON true
      WHERE c.company_id=$1 AND ($2::uuid IS NULL OR c.branch_id IS NULL OR c.branch_id=$2) ORDER BY c.updated_at DESC`, [m.companyId, m.branchId])).rows;
  }
  async get(user: AuthenticatedUser, id: string) {
    const { membership, row } = await this.scoped(user, id);
    const [items, obligations] = await Promise.all([
      this.db.query('SELECT * FROM contract_items WHERE company_id=$1 AND contract_id=$2 ORDER BY created_at', [membership.companyId,id]),
      this.db.query('SELECT * FROM contract_obligations WHERE company_id=$1 AND contract_id=$2 ORDER BY due_date NULLS LAST,created_at', [membership.companyId,id]),
    ]);
    return { ...row, items: items.rows, obligations: obligations.rows };
  }
  private validate(body: Record<string, unknown>, partial = false) {
    const required = ['title','contractType','startDate','endDate'];
    if (!partial && required.some(k => typeof body[k] !== 'string' || !(body[k] as string).trim())) throw new BadRequestException('Title, contract type, start date and end date are required.');
    if (body.contractType !== undefined && !['customer','supplier'].includes(String(body.contractType))) throw new BadRequestException('Contract type must be customer or supplier.');
    if (body.startDate && body.endDate && String(body.endDate) < String(body.startDate)) throw new BadRequestException('End date must be on or after start date.');
    if (body.contractValue !== undefined && (!Number.isFinite(Number(body.contractValue)) || Number(body.contractValue)<0)) throw new BadRequestException('Contract value must be zero or greater.');
    if (body.items !== undefined && (!Array.isArray(body.items) || body.items.length>200)) throw new BadRequestException('Items must be a list of at most 200 entries.');
  }
  async create(user: AuthenticatedUser, body: Record<string, unknown>) {
    this.validate(body);
    const m = await this.companyFor(user), companyId = m.companyId, id = randomUUID();
    const type = String(body.contractType);
    if (type === 'customer' && !body.customerId) throw new BadRequestException('Select a customer for a customer contract.');
    if (type === 'supplier' && !body.supplierId) throw new BadRequestException('Select a supplier for a supplier contract.');
    const number = typeof body.contractNumber === 'string' && body.contractNumber.trim() ? body.contractNumber.trim() : `CON-${new Date().getFullYear()}-${id.slice(0,8).toUpperCase()}`;
    await this.db.transaction(async client => {
      if (m.branchId && body.branchId && body.branchId !== m.branchId) throw new ForbiddenException('You cannot create a contract for another branch.');
      if (body.branchId) { const b=await client.query('SELECT id FROM branches WHERE id=$1 AND company_id=$2',[body.branchId,companyId]); if(!b.rows[0]) throw new NotFoundException('Branch not found in this company.'); }
      if (type==='customer') { const c=await client.query('SELECT id FROM customers WHERE id=$1 AND company_id=$2',[body.customerId,companyId]); if(!c.rows[0]) throw new NotFoundException('Customer not found in this company.'); }
      if (type==='supplier') { const s=await client.query('SELECT id FROM suppliers WHERE id=$1 AND company_id=$2',[body.supplierId,companyId]); if(!s.rows[0]) throw new NotFoundException('Supplier not found in this company.'); }
      await client.query(`INSERT INTO contracts(id,company_id,branch_id,contract_number,title,contract_type,counterparty_customer_id,counterparty_supplier_id,description,start_date,end_date,renewal_date,currency,contract_value,monthly_budget,owner_user_id,notes,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [id,companyId,body.branchId ?? m.branchId,number,String(body.title).trim(),type,type==='customer'?body.customerId:null,type==='supplier'?body.supplierId:null,body.description??null,body.startDate,body.endDate,body.renewalDate??null,body.currency??'KES',Number(body.contractValue??0),body.monthlyBudget==null?null:Number(body.monthlyBudget),user.userId,body.notes??null,user.userId]);
      await this.insertItems(client,companyId,id,body.items);
    });
    await this.audit.log({userId:user.userId,companyId,branchId:m.branchId,action:'create',entityType:'contract',entityId:id,oldValues:null,newValues:{title:body.title,contractType:type,status:'draft'},ipAddress:null});
    return this.get(user,id);
  }
  private async insertItems(client: any, companyId: string, contractId: string, raw: unknown) {
    if (raw===undefined) return;
    for (const value of raw as Record<string,unknown>[]) {
      if (!value || typeof value.description!=='string' || !value.description.trim()) throw new BadRequestException('Every contract item needs a description.');
      const qty=Number(value.quantity??1), price=Number(value.unitPrice??0);
      if(!Number.isFinite(qty)||qty<=0||!Number.isFinite(price)||price<0) throw new BadRequestException('Item quantities must be positive and prices cannot be negative.');
      const type=String(value.itemType??'material');
      if(!['material','service','labour','other'].includes(type)) throw new BadRequestException('Invalid contract item type.');
      if(value.productId) { const p=await client.query('SELECT id FROM products WHERE id=$1 AND company_id=$2',[value.productId,companyId]); if(!p.rows[0]) throw new NotFoundException('Contract material is not a product in this company.'); }
      await client.query(`INSERT INTO contract_items(company_id,contract_id,item_type,product_id,description,quantity,unit,unit_price,frequency) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [companyId,contractId,type,value.productId??null,value.description.trim(),qty,value.unit??null,price,['once','daily','weekly','monthly','quarterly','annually'].includes(String(value.frequency))?value.frequency:'once']);
    }
  }
  async update(user: AuthenticatedUser, id: string, body: Record<string, unknown>) {
    this.validate(body,true); const {membership,row}=await this.scoped(user,id); this.assertBranchWritable(membership,row);
    if(row.status!=='draft') throw new BadRequestException('Only draft contracts can be edited. Submit the contract again after making changes.');
    const allowed:Record<string,string>={title:'title',description:'description',startDate:'start_date',endDate:'end_date',renewalDate:'renewal_date',contractValue:'contract_value',monthlyBudget:'monthly_budget',notes:'notes'};
    const keys=Object.keys(allowed).filter(k=>body[k]!==undefined);
    await this.db.transaction(async client=>{
      if(keys.length) {
        const vals:unknown[]=[membership.companyId,id]; const sets=keys.map(k=>{vals.push(body[k]);return `${allowed[k]}=$${vals.length}`});
        await client.query(`UPDATE contracts SET ${sets.join(',')},updated_at=NOW() WHERE company_id=$1 AND id=$2 AND ($${vals.length+1}::uuid IS NULL OR branch_id IS NULL OR branch_id=$${vals.length+1})`,[...vals,membership.branchId] as (string|number|boolean|Date|null)[]);
      }
      if(body.items!==undefined) {
        await client.query('DELETE FROM contract_items WHERE company_id=$1 AND contract_id=$2',[membership.companyId,id]);
        await this.insertItems(client,membership.companyId,id,body.items);
      }
    });
    await this.audit.log({userId:user.userId,companyId:membership.companyId,branchId:membership.branchId,action:'update',entityType:'contract',entityId:id,oldValues:null,newValues:body,ipAddress:null});
    return this.get(user,id);
  }
  async submitForApproval(user: AuthenticatedUser,id:string) {
    const {membership,row}=await this.scoped(user,id); this.assertBranchWritable(membership,row);
    if(row.created_by!==user.userId) throw new ForbiddenException('Only the contract creator can submit it for approval.');
    if(!['draft','suspended'].includes(String(row.status))) throw new BadRequestException('Only draft or suspended contracts can be submitted for approval.');
    await this.db.transaction(async client=>{
      await client.query("UPDATE contracts SET status='pending_approval',updated_at=NOW() WHERE company_id=$1 AND id=$2",[membership.companyId,id]);
      await client.query("INSERT INTO approval_requests(company_id,branch_id,entity_type,entity_id,requester_user_id,status,decision_note,requested_at,decided_at,approver_user_id) VALUES($1,$2,'contract',$3,$4,'pending',NULL,NOW(),NULL,NULL) ON CONFLICT(company_id,entity_type,entity_id) DO UPDATE SET status='pending',requester_user_id=$4,approver_user_id=NULL,decision_note=NULL,requested_at=NOW(),decided_at=NULL",[membership.companyId,membership.branchId,id,user.userId]);
    });
    await this.audit.log({userId:user.userId,companyId:membership.companyId,branchId:membership.branchId,action:'submit_for_approval',entityType:'contract',entityId:id,oldValues:{status:row.status},newValues:{status:'pending_approval'},ipAddress:null});
    return this.get(user,id);
  }
  async changeStatus(user: AuthenticatedUser,id:string,status:'active'|'suspended') {
    const {membership,row}=await this.scoped(user,id); this.assertBranchWritable(membership,row);
    if(status==='active'&&!['draft','suspended'].includes(String(row.status))) throw new BadRequestException('Only draft or suspended contracts can be activated.');
    if(status==='suspended'&&row.status!=='active') throw new BadRequestException('Only active contracts can be suspended.');
    await this.db.query('UPDATE contracts SET status=$3,updated_at=NOW() WHERE company_id=$1 AND id=$2 AND ($4::uuid IS NULL OR branch_id IS NULL OR branch_id=$4)',[membership.companyId,id,status,membership.branchId]);
    await this.audit.log({userId:user.userId,companyId:membership.companyId,branchId:membership.branchId,action:'status_change',entityType:'contract',entityId:id,oldValues:{status:row.status},newValues:{status},ipAddress:null});
    return this.get(user,id);
  }
  async createRequisition(user: AuthenticatedUser, id: string) {
    const { membership, row } = await this.scoped(user, id); this.assertBranchWritable(membership,row);
    if (!['active', 'draft'].includes(String(row.status))) throw new BadRequestException('Only draft or active contracts can generate a requisition.');
    const planned = await this.db.query(`SELECT i.product_id, i.description, i.quantity, i.unit
      FROM contract_items i JOIN products p ON p.id=i.product_id AND p.company_id=i.company_id
      WHERE i.company_id=$1 AND i.contract_id=$2 AND i.item_type='material' AND i.product_id IS NOT NULL AND p.is_active=true
      ORDER BY i.created_at`, [membership.companyId, id]);
    if (!planned.rows.length) throw new BadRequestException('Add at least one material linked to an active inventory product before generating a requisition.');
    const requisitionId = randomUUID();
    const requestNumber = `REQ-${new Date().getFullYear()}-${requisitionId.slice(0,8).toUpperCase()}`;
    await this.db.transaction(async client => {
      await client.query(`INSERT INTO requisitions(id,company_id,branch_id,contract_id,request_number,requester_user_id,title,notes,required_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [requisitionId, membership.companyId, row.branch_id ?? membership.branchId, id, requestNumber, user.userId, `Contract materials: ${row.title}`, `Generated from contract ${row.contract_number}. Review quantities and submit for approval.`, null]);
      for (const item of planned.rows) {
        await client.query(`INSERT INTO requisition_items(company_id,requisition_id,product_id,quantity,notes) VALUES($1,$2,$3,$4,$5)`,
          [membership.companyId, requisitionId, item.product_id, item.quantity, `Contract ${row.contract_number}: ${item.description}${item.unit ? ` (${item.unit})` : ''}`]);
      }
    });
    await this.audit.log({ userId:user.userId, companyId:membership.companyId, branchId:typeof row.branch_id==='string'?row.branch_id:membership.branchId, action:'create_from_contract', entityType:'requisition', entityId:requisitionId, oldValues:null, newValues:{ contractId:id, contractNumber:row.contract_number, status:'draft', itemCount:planned.rows.length }, ipAddress:null });
    return { id: requisitionId, requestNumber, contractId:id, status:'draft', itemCount:planned.rows.length, message:'Draft requisition created. Review it and submit it through the normal approval workflow.' };
  }
  async addObligation(user:AuthenticatedUser,id:string,body:Record<string,unknown>) {
    if(typeof body.title!=='string'||!body.title.trim()) throw new BadRequestException('Obligation title is required.');
    if(body.dueDate!==undefined&&body.dueDate!==null&&(typeof body.dueDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)||Number.isNaN(Date.parse(body.dueDate+'T00:00:00Z'))||new Date(body.dueDate+'T00:00:00Z').toISOString().slice(0,10)!==body.dueDate)) throw new BadRequestException('Obligation dueDate must be a valid YYYY-MM-DD date.');
    if(body.notes!==undefined&&body.notes!==null&&(typeof body.notes!=='string'||body.notes.length>2000)) throw new BadRequestException('Obligation notes must be text up to 2000 characters.');
    const {membership,row}=await this.scoped(user,id); this.assertBranchWritable(membership,row); const obligationId=randomUUID();
    const dueDate=body.dueDate===undefined||body.dueDate===null?null:body.dueDate as string;
    const notes=body.notes===undefined||body.notes===null?null:body.notes as string;
    await this.db.query('INSERT INTO contract_obligations(id,company_id,contract_id,title,due_date,notes) VALUES($1,$2,$3,$4,$5,$6)',[obligationId,membership.companyId,id,body.title.trim(),dueDate,notes]);
    await this.audit.log({userId:user.userId,companyId:membership.companyId,branchId:membership.branchId,action:'create',entityType:'contract_obligation',entityId:obligationId,oldValues:null,newValues:{contractId:id,title:body.title,dueDate,status:'open'},ipAddress:null});
    return this.get(user,id);
  }
  async updateObligation(user:AuthenticatedUser,id:string,obligationId:string,body:Record<string,unknown>) {
    const {membership,row}=await this.scoped(user,id); this.assertBranchWritable(membership,row);
    const status=String(body.status??'');
    if(!['open','in_progress','completed','waived'].includes(status)) throw new BadRequestException('Invalid obligation status.');
    const result=await this.db.query('UPDATE contract_obligations SET status=$4,completed_at=CASE WHEN $4=\'completed\' THEN NOW() ELSE NULL END WHERE company_id=$1 AND contract_id=$2 AND id=$3 RETURNING id',[membership.companyId,id,obligationId,status]);
    if(!result.rows[0]) throw new NotFoundException('Contract obligation not found.');
    await this.audit.log({userId:user.userId,companyId:membership.companyId,branchId:membership.branchId,action:'status_change',entityType:'contract_obligation',entityId:obligationId,oldValues:null,newValues:{contractId:id,status},ipAddress:null});
    return this.get(user,id);
  }
}
