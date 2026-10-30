import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

@Injectable()
export class ApprovalsService {
  constructor(private readonly db: DatabaseService, private readonly memberships: MembershipsService, private readonly audit: AuditService) {}
  private async companyFor(user: AuthenticatedUser) {
    return user.companyId ? this.memberships.getMembershipForCompany(user.userId, user.companyId) : this.memberships.getMembership(user.userId);
  }

  async inbox(user: AuthenticatedUser) {
    const membership = await this.companyFor(user);
    const { companyId, branchId } = membership;
    const branchClause = branchId ? " AND a.branch_id=$3" : "";
    const params = branchId ? [companyId, user.userId, branchId] : [companyId, user.userId];
    return (await this.db.query(
      "SELECT a.id,a.entity_type,a.entity_id,a.status,a.requested_at,a.requester_user_id,u.full_name AS requester_name, " +
      "r.request_number,r.title,r.required_by,r.status AS requisition_status, " +
      "po.order_number,po.order_date,po.expected_date,po.total AS purchase_order_total,po.currency, s.name AS supplier_name, " +
      "c.contract_number,c.title AS contract_title,c.end_date AS contract_end_date,c.contract_value AS contract_value,c.currency AS contract_currency " +
      "FROM approval_requests a JOIN users u ON u.id=a.requester_user_id " +
      "LEFT JOIN requisitions r ON a.entity_type='requisition' AND r.id=a.entity_id AND r.company_id=a.company_id " +
      "LEFT JOIN purchase_orders po ON a.entity_type='purchase_order' AND po.id=a.entity_id AND po.company_id=a.company_id " +
      "LEFT JOIN suppliers s ON s.id=po.supplier_id AND s.company_id=po.company_id " +
      "LEFT JOIN contracts c ON a.entity_type='contract' AND c.id=a.entity_id AND c.company_id=a.company_id " +
      "WHERE a.company_id=$1 AND a.status='pending' AND a.requester_user_id<>$2 " + branchClause + " " +
      "AND ((a.entity_type='requisition' AND r.id IS NOT NULL) OR (a.entity_type='purchase_order' AND po.id IS NOT NULL) OR (a.entity_type='contract' AND c.id IS NOT NULL)) " +
      "ORDER BY a.requested_at", params)).rows;
  }

  async submitPurchaseOrder(user: AuthenticatedUser, id: string) {
    const membership = await this.companyFor(user);
    if (membership.branchId) throw new ForbiddenException('Purchase orders are company-wide until branch attribution is supported. A company-wide procurement administrator must submit them for approval.');
    const oldStatus = await this.db.transaction(async client => {
      const found = await client.query(
        'SELECT id,status,created_by FROM purchase_orders WHERE company_id=$1 AND id=$2 FOR UPDATE',
        [membership.companyId, id]);
      const row = found.rows[0];
      if (!row) throw new NotFoundException('Purchase order not found.');
      if (row.created_by !== user.userId) throw new BadRequestException('Only the purchase order creator can submit it for approval.');
      if (row.status !== 'draft') throw new BadRequestException('Only draft purchase orders can be submitted for approval.');
      const existing = await client.query("SELECT status FROM approval_requests WHERE company_id=$1 AND entity_type='purchase_order' AND entity_id=$2", [membership.companyId, id]);
      if (existing.rows[0]?.status === 'pending') throw new BadRequestException('This purchase order is already awaiting approval.');
      await client.query(
        "INSERT INTO approval_requests(company_id,branch_id,entity_type,entity_id,requester_user_id,status,decision_note,requested_at,decided_at,approver_user_id) " +
        "VALUES($1,$2,'purchase_order',$3,$4,'pending',NULL,NOW(),NULL,NULL) " +
        "ON CONFLICT(company_id,entity_type,entity_id) DO UPDATE SET status='pending',decision_note=NULL,requested_at=NOW(),decided_at=NULL,approver_user_id=NULL",
        [membership.companyId, membership.branchId, id, user.userId]);
      await this.audit.logInTransaction(client,{userId:user.userId,companyId:membership.companyId,branchId:membership.branchId,action:'submit_for_approval',entityType:'purchase_order',entityId:id,oldValues:{status:row.status},newValues:{status:'pending_approval'},ipAddress:null});
      return row.status as string;
    });
    return { id, status:'pending_approval' };
  }

  async submitContract(user: AuthenticatedUser, id: string) {
    const membership = await this.companyFor(user);
    const result = await this.db.transaction(async client => {
      const found = await client.query('SELECT id,status,created_by,branch_id FROM contracts WHERE company_id=$1 AND id=$2 AND ($3::uuid IS NULL OR branch_id=$3) FOR UPDATE',[membership.companyId,id,membership.branchId]);
      const row=found.rows[0];
      if(!row) throw new NotFoundException('Contract not found.');
      if(row.created_by!==user.userId) throw new BadRequestException('Only the contract creator can submit it for approval.');
      if(!['draft','suspended'].includes(String(row.status))) throw new BadRequestException('Only draft or suspended contracts can be submitted for approval.');
      await client.query("UPDATE contracts SET status='pending_approval',updated_at=NOW() WHERE company_id=$1 AND id=$2",[membership.companyId,id]);
      await client.query("INSERT INTO approval_requests(company_id,branch_id,entity_type,entity_id,requester_user_id,status,decision_note,requested_at,decided_at,approver_user_id) VALUES($1,$2,'contract',$3,$4,'pending',NULL,NOW(),NULL,NULL) ON CONFLICT(company_id,entity_type,entity_id) DO UPDATE SET status='pending',requester_user_id=$4,approver_user_id=NULL,decision_note=NULL,requested_at=NOW(),decided_at=NULL",[membership.companyId,row.branch_id ?? null,id,user.userId]);
      await this.audit.logInTransaction(client,{userId:user.userId,companyId:membership.companyId,branchId:membership.branchId,action:'submit_for_approval',entityType:'contract',entityId:id,oldValues:{status:row.status},newValues:{status:'pending_approval'},ipAddress:null});
      return {status:row.status as string};
    });
    return {id,status:'pending_approval'};
  }

  async decide(user: AuthenticatedUser, id: string, decision: 'approved'|'rejected', note?: string) {
    const membership = await this.companyFor(user);
    const result = await this.db.transaction(async client => {
      const branchClause = membership.branchId ? ' AND branch_id=$3' : '';
      const lookupParams = membership.branchId ? [membership.companyId,id,membership.branchId] : [membership.companyId,id];
      const found = await client.query(`SELECT * FROM approval_requests WHERE company_id=$1 AND id=$2${branchClause} FOR UPDATE`, lookupParams);
      const row = found.rows[0];
      if (!row) throw new NotFoundException('Approval request not found.');
      if (row.status !== 'pending') throw new BadRequestException('This approval has already been decided.');
      if (row.requester_user_id === user.userId) throw new BadRequestException('Requesters cannot approve or reject their own requests.');
      if (row.entity_type === 'requisition') {
        const req = await client.query('SELECT id,status,branch_id FROM requisitions WHERE company_id=$1 AND id=$2 FOR UPDATE', [membership.companyId,row.entity_id]);
        if (!req.rows[0] || req.rows[0].status !== 'pending_approval') throw new BadRequestException('The requisition is not awaiting approval.');
        if (membership.branchId && req.rows[0].branch_id !== membership.branchId) throw new NotFoundException('Requisition not found in this branch.');
        await client.query('UPDATE requisitions SET status=$1,updated_at=NOW() WHERE company_id=$2 AND id=$3', [decision,membership.companyId,row.entity_id]);
      } else if (row.entity_type === 'purchase_order') {
        const po = await client.query('SELECT id,status FROM purchase_orders WHERE company_id=$1 AND id=$2 FOR UPDATE', [membership.companyId,row.entity_id]);
        if (!po.rows[0] || po.rows[0].status !== 'draft') throw new BadRequestException('The purchase order is not awaiting approval.');
        if (decision === 'approved') {
          await client.query("UPDATE purchase_orders SET status='ordered',updated_at=NOW() WHERE company_id=$1 AND id=$2", [membership.companyId,row.entity_id]);
        }
      } else if (row.entity_type === 'contract') {
        const contract=await client.query('SELECT id,status FROM contracts WHERE company_id=$1 AND id=$2 AND ($3::uuid IS NULL OR branch_id=$3) FOR UPDATE',[membership.companyId,row.entity_id,membership.branchId]);
        if(!contract.rows[0]||contract.rows[0].status!=='pending_approval') throw new BadRequestException('The contract is not awaiting approval.');
        await client.query('UPDATE contracts SET status=$1,updated_at=NOW() WHERE company_id=$2 AND id=$3',[decision==='approved'?'active':'draft',membership.companyId,row.entity_id]);
      } else {
        throw new BadRequestException('Unsupported approval request type.');
      }
      await client.query('UPDATE approval_requests SET status=$1,approver_user_id=$2,decision_note=$3,decided_at=NOW() WHERE company_id=$4 AND id=$5', [decision,user.userId,note??null,membership.companyId,id]);
      await this.audit.logInTransaction(client,{userId:user.userId,companyId:membership.companyId,branchId:membership.branchId,action:decision==='approved'?'approve':'reject',entityType:'approval_request',entityId:id,oldValues:{status:'pending'},newValues:{status:decision,entityId:row.entity_id,entityType:row.entity_type,note:note??null},ipAddress:null});
      return { entityId: row.entity_id as string, entityType: row.entity_type as string };
    });
    return { id, entityId:result.entityId, entityType:result.entityType, status:decision };
  }
}
