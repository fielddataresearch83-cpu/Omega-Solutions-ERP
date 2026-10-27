import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import type { CreateInvitationDto } from './dto/invitations.dto.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;


@Injectable()
export class InvitationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly memberships: MembershipsService,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async list(user: AuthenticatedUser) {
    const actor = await this.memberships.requireOwnerOrAdmin(user.userId, user.companyId!);
    return (await this.db.query(
      `SELECT i.id, i.email, i.role::text AS role, i.branch_id, i.expires_at,
              i.accepted_at, i.revoked_at, i.created_at, u.full_name AS invited_by_name
       FROM company_invitations i
       JOIN users u ON u.id = i.invited_by
       WHERE i.company_id = $1
       ORDER BY i.created_at DESC
       LIMIT 100`,
      [actor.companyId],
    )).rows;
  }

  async create(user: AuthenticatedUser, dto: CreateInvitationDto) {
    const actor = await this.memberships.requireOwnerOrAdmin(user.userId, user.companyId!);
    const email = dto.email.trim().toLowerCase();
    if (dto.role === 'admin' && actor.role !== 'owner') {
      throw new ForbiddenException('Only a company owner can invite an admin.');
    }

    // Neon Auth is the sole invitation email sender. Fail closed if it is not configured.
    const neonAuthBaseUrl = process.env.NEON_AUTH_BASE_URL?.replace(/\/$/, '');
    const appBaseUrl = process.env.APP_BASE_URL || process.env.CORS_ORIGIN?.split(',')[0]?.trim();
    if (!neonAuthBaseUrl || !appBaseUrl) {
      throw new ServiceUnavailableException('Neon Auth invitation email is not configured. Set NEON_AUTH_BASE_URL and APP_BASE_URL.');
    }

    if (dto.branchId) {
      const branch = await this.db.query(
        'SELECT id FROM branches WHERE id = $1 AND company_id = $2 AND is_active = true',
        [dto.branchId, actor.companyId],
      );
      if (!branch.rows.length) throw new NotFoundException('Active branch not found in this company.');
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    // Serialize quota checks with the invitation insert so parallel requests cannot
    // consume the same final user slot. Delivery happens after commit; failures revoke it.
    const inserted = await this.db.transaction(async client => {
      await client.query(
        `UPDATE company_invitations SET revoked_at = NOW(), updated_at = NOW()
         WHERE company_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= NOW()`,
        [actor.companyId, email],
      );
      const existing = await client.query(
        `SELECT id FROM company_invitations
         WHERE company_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL
           AND expires_at > NOW()
         LIMIT 1`,
        [actor.companyId, email],
      );
      if (existing.rows.length) throw new ConflictException('An active invitation already exists for this email.');
      await this.subscriptions.assertUserCapacity(actor.companyId, client);
      return client.query<{ id: string }>(
        `INSERT INTO company_invitations
          (company_id, invited_by, email, role, branch_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [actor.companyId, user.userId, email, dto.role, dto.branchId ?? null, tokenHash, expiresAt],
      );
    });
    const invitationId = inserted.rows[0].id;
    const acceptUrl = new URL('/accept-invitation', appBaseUrl);
    acceptUrl.searchParams.set('invitationToken', token);

    try {
      const response = await fetch(`${neonAuthBaseUrl}/sign-in/magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, name: email.split('@')[0], callbackURL: acceptUrl.toString() }),
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) {
        const providerMessage = (await response.text()).replace(/\\s+/g, ' ').slice(0, 300);
        console.error(`Neon Auth invitation email delivery failed: HTTP ${response.status}; response=${providerMessage}`);
        throw new Error(`Neon Auth returned HTTP ${response.status}`);
      }
    } catch {
      await this.db.query('UPDATE company_invitations SET revoked_at = NOW(), updated_at = NOW() WHERE id = $1 AND accepted_at IS NULL', [invitationId]);
      throw new ServiceUnavailableException('Neon Auth could not send the invitation email; the invitation was cancelled.');
    }

    await this.audit.log({
      userId: user.userId, companyId: actor.companyId, branchId: actor.branchId,
      action: 'create_invitation', entityType: 'company_invitation', entityId: invitationId,
      oldValues: null, newValues: { email, role: dto.role, branchId: dto.branchId ?? null, expiresAt: expiresAt.toISOString() },
      ipAddress: null,
    });
    return { id: invitationId, email, role: dto.role, expiresAt, status: 'sent' as const, deliveryProvider: 'neon-auth' as const };
  }

  async revoke(user: AuthenticatedUser, invitationId: string) {
    const actor = await this.memberships.requireOwnerOrAdmin(user.userId, user.companyId!);
    const result = await this.db.query(
      `UPDATE company_invitations SET revoked_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL
       RETURNING id, email, role::text AS role`,
      [invitationId, actor.companyId],
    );
    if (!result.rows.length) throw new NotFoundException('Pending invitation not found in this company.');
    await this.audit.log({
      userId: user.userId, companyId: actor.companyId, branchId: actor.branchId,
      action: 'revoke_invitation', entityType: 'company_invitation', entityId: invitationId,
      oldValues: null, newValues: { email: result.rows[0].email, role: result.rows[0].role },
      ipAddress: null,
    });
    return { success: true };
  }

  async accept(user: AuthenticatedUser, rawToken: string) {
    if (!user.companyId) throw new UnauthorizedException('Sign in with a verified account before accepting an invitation.');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const accepted = await this.db.transaction(async client => {
      const found = await client.query<{
        id: string; company_id: string; email: string; role: string; branch_id: string | null;
      }>(
        `SELECT id, company_id, email, role::text AS role, branch_id
         FROM company_invitations
         WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
         FOR UPDATE`,
        [tokenHash],
      );
      const invite = found.rows[0];
      if (!invite) throw new NotFoundException('Invitation is invalid, expired, or already used.');
      if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
        throw new ForbiddenException('This invitation was sent to a different email address.');
      }
      const existing = await client.query(
        'SELECT id FROM company_memberships WHERE user_id = $1 AND company_id = $2',
        [user.userId, invite.company_id],
      );
      if (existing.rows.length) throw new ConflictException('This account already has a membership in the invited company.');
      await this.subscriptions.assertUserCapacity(invite.company_id, client, true);
      if (invite.branch_id) {
        const branch = await client.query(
          'SELECT id FROM branches WHERE id = $1 AND company_id = $2 AND is_active = true',
          [invite.branch_id, invite.company_id],
        );
        if (!branch.rows.length) throw new ConflictException('The invited branch is no longer active.');
      }
      await client.query(
        `INSERT INTO company_memberships (user_id, company_id, branch_id, role, is_active)
         VALUES ($1, $2, $3, $4, true)`,
        [user.userId, invite.company_id, invite.branch_id, invite.role],
      );
      await client.query(
        'UPDATE company_invitations SET accepted_at = NOW(), updated_at = NOW() WHERE id = $1',
        [invite.id],
      );
      return invite;
    });
    await this.audit.log({
      userId: user.userId, companyId: accepted.company_id, branchId: accepted.branch_id,
      action: 'accept_invitation', entityType: 'company_invitation', entityId: accepted.id,
      oldValues: null, newValues: { email: accepted.email, role: accepted.role },
      ipAddress: null,
    });
    return { success: true, companyId: accepted.company_id, role: accepted.role };
  }
}
