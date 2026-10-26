import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import type { CreateRequisitionDto } from './dto/requisition.dto.js';

@Injectable()
export class RequisitionsService {
  constructor(private readonly db: DatabaseService, private readonly memberships: MembershipsService, private readonly audit: AuditService) {}
  private async companyFor(user: AuthenticatedUser) {
    return user.companyId ? this.memberships.getMembershipForCompany(user.userId, user.companyId) : this.memberships.getMembership(user.userId);
  }
  async list(user: AuthenticatedUser) {
    const { companyId, branchId } = await this.companyFor(user);
    return (await this.db.query(`SELECT r.*, u.full_name AS requester_name,
      (SELECT COUNT(*)::int FROM requisition_items i WHERE i.company_id=r.company_id AND i.requisition_id=r.id) AS item_count
      FROM requisitions r JOIN users u ON u.id=r.requester_user_id
      WHERE r.company_id=$1 AND ($2::uuid IS NULL OR r.branch_id IS NULL OR r.branch_id=$2::uuid)
      ORDER BY r.created_at DESC`, [companyId, branchId ?? null])).rows;
  }
  async get(user: AuthenticatedUser, id: string) {
    const { companyId, branchId } = await this.companyFor(user);
    const row = await this.db.query('SELECT * FROM requisitions WHERE company_id=$1 AND id=$2 AND ($3::uuid IS NULL OR branch_id IS NULL OR branch_id=$3::uuid)', [companyId, id, branchId ?? null]);
    if (!row.rows[0]) throw new NotFoundException('Requisition not found.');
    const items = await this.db.query(`SELECT i.*, p.name AS product_name, p.sku FROM requisition_items i
      JOIN products p ON p.id=i.product_id AND p.company_id=i.company_id
      WHERE i.company_id=$1 AND i.requisition_id=$2 ORDER BY i.created_at`, [companyId, id]);
    return { ...row.rows[0], items: items.rows };
  }
  async create(user: AuthenticatedUser, dto: CreateRequisitionDto) {
    const membership = await this.companyFor(user);
    const companyId = membership.companyId;
    if (membership.branchId && dto.branchId && dto.branchId !== membership.branchId) {
      throw new ForbiddenException('You can only create requisitions for your assigned branch.');
    }
    const targetBranchId = membership.branchId ?? dto.branchId ?? null;
    const id = await this.db.transaction(async client => {
      if (targetBranchId) {
        const branch = await client.query('SELECT id FROM branches WHERE id=$1 AND company_id=$2', [targetBranchId, companyId]);
        if (!branch.rows[0]) throw new NotFoundException('Branch not found in this company.');
      }
      for (const item of dto.items) {
        const product = await client.query('SELECT id FROM products WHERE id=$1 AND company_id=$2 AND is_active=true', [item.productId, companyId]);
        if (!product.rows[0]) throw new NotFoundException('A requested product is not active in this company.');
      }
      const id = randomUUID();
      const number = `REQ-${new Date().getFullYear()}-${id.slice(0,8).toUpperCase()}`;
      await client.query(`INSERT INTO requisitions(id,company_id,branch_id,request_number,requester_user_id,title,notes,required_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id, companyId, targetBranchId, number, user.userId, dto.title.trim(), dto.notes ?? null, dto.requiredBy ?? null]);
      for (const item of dto.items) {
        await client.query(`INSERT INTO requisition_items(company_id,requisition_id,product_id,quantity,notes) VALUES($1,$2,$3,$4,$5)`,
          [companyId, id, item.productId, item.quantity, item.notes ?? null]);
      }
      return id;
    });
    await this.audit.log({ userId:user.userId, companyId, branchId:membership.branchId, action:'create', entityType:'requisition', entityId:id, oldValues:null, newValues:{ title:dto.title, status:'draft' }, ipAddress:null });
    return this.get(user, id);
  }
  async submit(user: AuthenticatedUser, id: string) {
    const membership = await this.companyFor(user);
    const result = await this.db.transaction(async client => {
      const found = await client.query('SELECT * FROM requisitions WHERE company_id=$1 AND id=$2 FOR UPDATE', [membership.companyId, id]);
      const row = found.rows[0];
      if (!row) throw new NotFoundException('Requisition not found.');
      if (membership.branchId && row.branch_id !== membership.branchId) throw new NotFoundException('Requisition not found in this branch.');
      if (row.requester_user_id !== user.userId) throw new BadRequestException('Only the requester can submit this requisition.');
      if (row.status !== 'draft' && row.status !== 'rejected') throw new BadRequestException('Only draft or rejected requisitions can be submitted.');
      await client.query(`INSERT INTO approval_requests(company_id,branch_id,entity_type,entity_id,requester_user_id,status,decision_note,requested_at,decided_at,approver_user_id)
        VALUES($1,$2,'requisition',$3,$4,'pending',NULL,NOW(),NULL,NULL)
        ON CONFLICT(company_id,entity_type,entity_id) DO UPDATE SET status='pending',decision_note=NULL,requested_at=NOW(),decided_at=NULL,approver_user_id=NULL`,
        [membership.companyId, row.branch_id, id, user.userId]);
      await client.query(`UPDATE requisitions SET status='pending_approval',updated_at=NOW() WHERE company_id=$1 AND id=$2`, [membership.companyId,id]);
      return row;
    });
    await this.audit.log({ userId:user.userId, companyId:membership.companyId, branchId:membership.branchId, action:'submit_for_approval', entityType:'requisition', entityId:id, oldValues:{status:result.status}, newValues:{status:'pending_approval'}, ipAddress:null });
    return this.get(user,id);
  }
}
