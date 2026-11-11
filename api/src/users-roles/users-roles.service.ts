import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import type { UpdateMembershipRoleDto } from './dto/update-membership-role.dto.js';

@Injectable()
export class UsersRolesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly memberships: MembershipsService,
    private readonly audit: AuditService,
  ) {}

  private companyFor(user: AuthenticatedUser) {
    return user.companyId
      ? this.memberships.getMembershipForCompany(user.userId, user.companyId)
      : this.memberships.getMembership(user.userId);
  }

  async list(user: AuthenticatedUser) {
    const membership = await this.companyFor(user);
    return (await this.db.query(
      `SELECT m.id AS membership_id, m.user_id, m.company_id, m.branch_id, m.role, m.is_active,
              u.full_name, u.email, u.phone, u.last_login_at, u.created_at AS user_created_at,
              b.name AS branch_name,
              COALESCE(array_agg(DISTINCT p.permission) FILTER (WHERE p.permission IS NOT NULL), ARRAY[]::text[]) AS permissions
       FROM company_memberships m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN branches b ON b.id = m.branch_id AND b.company_id = m.company_id
       LEFT JOIN role_permissions rp ON rp.role = m.role
       LEFT JOIN permissions p ON p.id = rp.permission_id
       WHERE m.company_id = $1
         AND (
           $2::uuid IS NULL
           OR m.branch_id IS NULL
           OR m.branch_id = $2::uuid
           OR $3::text IN ('owner', 'admin')
         )
       GROUP BY m.id, u.id, b.name
       ORDER BY u.full_name, u.email`,
      [membership.companyId, membership.branchId, membership.role],
    )).rows;
  }

  async roleCatalog(user: AuthenticatedUser) {
    const membership = await this.companyFor(user);
    await this.memberships.requireOwnerOrAdmin(user.userId, membership.companyId);
    return (await this.db.query(
      `SELECT r.role::text AS role,
              COALESCE(array_agg(p.permission ORDER BY p.permission) FILTER (WHERE p.permission IS NOT NULL), ARRAY[]::text[]) AS permissions
       FROM (SELECT unnest(enum_range(NULL::user_role)) AS role) r
       LEFT JOIN role_permissions rp ON rp.role = r.role
       LEFT JOIN permissions p ON p.id = rp.permission_id
       GROUP BY r.role ORDER BY r.role`,
    )).rows;
  }

  async updateRole(user: AuthenticatedUser, membershipId: string, dto: UpdateMembershipRoleDto) {
    const actor = await this.companyFor(user);
    const actorMembership = await this.memberships.requireOwnerOrAdmin(user.userId, actor.companyId);
    // Reject unauthorized admin grants before opening a database transaction.
    if (dto.role === 'admin' && actorMembership.role !== 'owner') {
      throw new ForbiddenException('Only a company owner can grant the admin role.');
    }
    const result = await this.db.transaction(async client => {
      const found = await client.query(
        'SELECT id,user_id,role,is_active FROM company_memberships WHERE company_id=$1 AND id=$2 FOR UPDATE',
        [actor.companyId, membershipId],
      );
      const target = found.rows[0];
      if (!target) throw new NotFoundException('Company membership not found.');
      if (target.user_id === user.userId) throw new BadRequestException('You cannot change your own role.');
      if (dto.role === 'admin' && actorMembership.role !== 'owner') {
        throw new ForbiddenException('Only a company owner can grant the admin role.');
      }
      if (target.role === 'owner') throw new ForbiddenException('Owner membership changes require the dedicated ownership-transfer process.');
      const updated = await client.query(
        'UPDATE company_memberships SET role=$1,updated_at=NOW() WHERE company_id=$2 AND id=$3 RETURNING id,user_id,role,is_active',
        [dto.role, actor.companyId, membershipId],
      );
      return { before: target, after: updated.rows[0] };
    });
    await this.audit.log({
      userId: user.userId, companyId: actor.companyId, branchId: actor.branchId,
      action: 'update_role', entityType: 'company_membership', entityId: membershipId,
      oldValues: { role: result.before.role }, newValues: { role: result.after.role }, ipAddress: null,
    });
    return result.after;
  }
}
