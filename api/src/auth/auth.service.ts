import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database.service.js';
import { RegisterDto, LoginDto, RefreshDto, NeonExchangeDto } from './dto/auth.dto.js';
import { verifyNeonIdentityToken } from './neon-token-verifier.js';
import type {
  AuthenticatedUser,
  JwtPayload,
  TokenPair,
} from './interfaces/authenticated-user.js';
import { MfaService } from './mfa.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly mfaService: MfaService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async register(dto: RegisterDto): Promise<{ userId: string; companyId: string | null }> {
    const existing = await this.db.query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [dto.email.toLowerCase()],
    );

    if (existing.rowCount && existing.rowCount > 0) {
      throw new ConflictException('Email already registered');
    }

    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const companyName = dto.companyName?.trim() || `${dto.fullName}'s Company`;

    const result = await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO users (id, email, password_hash, full_name, phone, is_active)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [userId, dto.email.toLowerCase(), passwordHash, dto.fullName, dto.phone ?? null],
      );

      const companyResult = await client.query<{ id: string }>(
        `INSERT INTO companies (name, currency, timezone, is_active)
         VALUES ($1, 'KES', 'Africa/Nairobi', true)
         RETURNING id`,
        [companyName],
      );

      const companyId = companyResult.rows[0].id;

      await client.query(
        `INSERT INTO company_memberships (user_id, company_id, role, is_active)
         VALUES ($1, $2, 'owner', true)`,
        [userId, companyId],
      );

      return { companyId };
    });

    return { userId, companyId: result.companyId };
  }

  async getNeonIdentityCompanies(token: string): Promise<Array<{ id: string; name: string; role: string; branchId: string | null }>> {
    const identity = await verifyNeonIdentityToken(token);
    const neonUserResult = await this.db.query<{ id: string; email: string; emailVerified: boolean }>(
      'SELECT id, email, "emailVerified" AS "emailVerified" FROM neon_auth."user" WHERE id = $1 LIMIT 1',
      [identity.sub],
    );
    const neonUser = neonUserResult.rows[0];
    if (!neonUser || neonUser.emailVerified !== true || !neonUser.email) {
      throw new UnauthorizedException('Verify your email address before accessing Omega.');
    }
    const omegaUser = await this.db.query<{ id: string; is_active: boolean }>(
      'SELECT id, is_active FROM users WHERE lower(email) = $1',
      [neonUser.email.trim().toLowerCase()],
    );
    if (!omegaUser.rows[0]) return [];
    if (!omegaUser.rows[0].is_active) throw new UnauthorizedException('Account is deactivated');
    return this.getActiveCompanies(omegaUser.rows[0].id);
  }
  async exchangeNeonIdentity(dto: NeonExchangeDto): Promise<(TokenPair & { user: Omit<AuthenticatedUser, 'permissions'> }) | { mfaRequired: true; mfaChallengeToken: string }> {
    const identity = await verifyNeonIdentityToken(dto.token);
    // Read the verified identity from Neon Auth's own database schema; never trust an email supplied by the browser.
    const neonUserResult = await this.db.query<{
      id: string;
      email: string;
      emailVerified: boolean;
      name: string | null;
    }>(
      'SELECT id, email, "emailVerified" AS "emailVerified", name FROM neon_auth."user" WHERE id = $1 LIMIT 1',
      [identity.sub],
    );
    const neonUser = neonUserResult.rows[0];
    if (!neonUser || neonUser.emailVerified !== true || !neonUser.email) {
      throw new UnauthorizedException('Verify your email address before accessing Omega.');
    }
    const email = neonUser.email.trim().toLowerCase();
    const fullName = dto.fullName?.trim() || neonUser.name?.trim() || email.split('@')[0] || 'Omega User';

    const existing = await this.db.query<{
      id: string;
      email: string;
      full_name: string;
      is_active: boolean;
    }>(
      'SELECT id, email, full_name, is_active FROM users WHERE lower(email) = $1',
      [email],
    );
    let user = existing.rows[0];
    let membership: { companyId: string | null; branchId: string | null; role: string };

    if (user && !user.is_active) {
      throw new UnauthorizedException('Account is deactivated');
    }
    if (!user && dto.intent !== 'register') {
      throw new UnauthorizedException('No Omega account exists for this email. Please register first or accept a company invitation.');
    }
    if (user && dto.intent === 'register') {
      throw new ConflictException('An Omega account already exists for this email. Please sign in instead.');
    }

    if (!user) {
      const userId = uuidv4();
      const passwordHash = await bcrypt.hash(randomBytes(48).toString('hex'), BCRYPT_ROUNDS);
      const companyName = dto.companyName?.trim() || `${fullName}'s Company`;
      const created = await this.db.transaction(async (client) => {
        await client.query(
          `INSERT INTO users (id, email, password_hash, full_name, phone, is_active)
           VALUES ($1, $2, $3, $4, $5, true)`,
          [userId, email, passwordHash, fullName, dto.phone ?? null],
        );
        const company = await client.query<{ id: string }>(
          `INSERT INTO companies (name, currency, timezone, is_active)
           VALUES ($1, 'KES', 'Africa/Nairobi', true)
           RETURNING id`,
          [companyName],
        );
        const companyId = company.rows[0].id;
        await client.query(
          `INSERT INTO company_memberships (user_id, company_id, role, is_active)
           VALUES ($1, $2, 'owner', true)`,
          [userId, companyId],
        );
        return { companyId };
      });
      user = { id: userId, email, full_name: fullName, is_active: true };
      membership = { companyId: created.companyId, branchId: null, role: 'owner' };
    } else {
      membership = await this.getUserMembership(user.id, dto.companyId);
      if (!membership.companyId) {
        throw new UnauthorizedException('This account has no active company membership. Contact your administrator.');
      }
    }

    const mfaStatus = await this.mfaService.status(user.id);
    if (mfaStatus.enabled) return this.createMfaChallenge(user.id, user.email, membership.companyId);

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      companyId: membership.companyId,
      branchId: membership.branchId,
      role: membership.role,
    };
    return {
      accessToken: this.issueToken(payload, false),
      refreshToken: await this.issueTrackedRefreshToken(payload),
      user: {
        userId: user.id,
        email: user.email,
        fullName: user.full_name,
        companyId: membership.companyId,
        branchId: membership.branchId,
        role: membership.role,
      },
    };
  }


  async exchangeNeonInvitation(dto: { token: string; invitationToken: string }): Promise<(TokenPair & { user: Omit<AuthenticatedUser, 'permissions'> }) | { mfaRequired: true; mfaChallengeToken: string }> {
    const identity = await verifyNeonIdentityToken(dto.token);
    const neonUserResult = await this.db.query<{
      id: string; email: string; emailVerified: boolean; name: string | null;
    }>(
      'SELECT id, email, "emailVerified" AS "emailVerified", name FROM neon_auth."user" WHERE id = $1 LIMIT 1',
      [identity.sub],
    );
    const neonUser = neonUserResult.rows[0];
    if (!neonUser || neonUser.emailVerified !== true || !neonUser.email) {
      throw new UnauthorizedException('Verify your email address before accepting this invitation.');
    }
    const email = neonUser.email.trim().toLowerCase();
    const tokenHash = createHash('sha256').update(dto.invitationToken).digest('hex');
    const joined = await this.db.transaction(async (client) => {
      const found = await client.query<{
        id: string; company_id: string; email: string; role: string; branch_id: string | null;
      }>(
        `SELECT id, company_id, email, role::text AS role, branch_id
         FROM company_invitations
         WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
         FOR UPDATE`,
        [tokenHash],
      );
      const invitation = found.rows[0];
      if (!invitation) throw new NotFoundException('Invitation is invalid, expired, or already used.');
      if (invitation.email.trim().toLowerCase() !== email) {
        throw new UnauthorizedException('This invitation was sent to a different email address.');
      }
      const company = await client.query<{ id: string }>(
        'SELECT id FROM companies WHERE id = $1 AND is_active = true',
        [invitation.company_id],
      );
      if (!company.rows.length) throw new UnauthorizedException('The invited company is inactive.');
      if (invitation.branch_id) {
        const branch = await client.query(
          'SELECT id FROM branches WHERE id = $1 AND company_id = $2 AND is_active = true',
          [invitation.branch_id, invitation.company_id],
        );
        if (!branch.rows.length) throw new ConflictException('The invited branch is no longer active.');
      }
      let omegaUser = (await client.query<{
        id: string; email: string; full_name: string; is_active: boolean;
      }>(
        'SELECT id, email, full_name, is_active FROM users WHERE lower(email) = $1 FOR UPDATE',
        [email],
      )).rows[0];
      if (omegaUser && !omegaUser.is_active) throw new UnauthorizedException('Account is deactivated.');
      if (!omegaUser) {
        const userId = uuidv4();
        const fullName = neonUser.name?.trim() || email.split('@')[0] || 'Omega User';
        const passwordHash = await bcrypt.hash(randomBytes(48).toString('hex'), BCRYPT_ROUNDS);
        const inserted = await client.query<{
          id: string; email: string; full_name: string; is_active: boolean;
        }>(
          `INSERT INTO users (id, email, password_hash, full_name, phone, is_active)
           VALUES ($1, $2, $3, $4, NULL, true)
           RETURNING id, email, full_name, is_active`,
          [userId, email, passwordHash, fullName],
        );
        omegaUser = inserted.rows[0];
      }
      const membership = await client.query(
        'SELECT id FROM company_memberships WHERE user_id = $1 AND company_id = $2 FOR UPDATE',
        [omegaUser.id, invitation.company_id],
      );
      if (membership.rows.length) throw new ConflictException('This account already belongs to the invited company.');
      // This exchange endpoint accepts the invitation directly, so enforce the same
      // reserved-user quota as the regular invitation acceptance endpoint.
      await this.subscriptions.assertUserCapacity(invitation.company_id, client, true);
      await client.query(
        `INSERT INTO company_memberships (user_id, company_id, branch_id, role, is_active)
         VALUES ($1, $2, $3, $4, true)`,
        [omegaUser.id, invitation.company_id, invitation.branch_id, invitation.role],
      );
      await client.query(
        'UPDATE company_invitations SET accepted_at = NOW(), updated_at = NOW() WHERE id = $1',
        [invitation.id],
      );
      // Record acceptance in the same transaction as membership activation and token consumption.
      await client.query(
        `INSERT INTO audit_logs
          (user_id, company_id, branch_id, action, entity_type, entity_id, old_values, new_values, ip_address)
         VALUES ($1, $2, $3, 'accept_invitation', 'company_invitation', $4, NULL, $5, NULL)`,
        [omegaUser.id, invitation.company_id, invitation.branch_id, invitation.id, JSON.stringify({ email: invitation.email, role: invitation.role })],
      );
      return {
        userId: omegaUser.id, email: omegaUser.email, fullName: omegaUser.full_name,
        companyId: invitation.company_id, branchId: invitation.branch_id, role: invitation.role,
      };
    });
    const mfaStatus = await this.mfaService.status(joined.userId);
    if (mfaStatus.enabled) return this.createMfaChallenge(joined.userId, joined.email, joined.companyId);
    const payload: JwtPayload = {
      sub: joined.userId, email: joined.email, companyId: joined.companyId,
      branchId: joined.branchId, role: joined.role,
    };
    return {
      accessToken: this.issueToken(payload, false),
      refreshToken: await this.issueTrackedRefreshToken(payload),
      user: {
        userId: joined.userId, email: joined.email, fullName: joined.fullName,
        companyId: joined.companyId, branchId: joined.branchId, role: joined.role,
      },
    };
  }

  async login(dto: LoginDto): Promise<(TokenPair & { user: Omit<AuthenticatedUser, 'permissions'> }) | { mfaRequired: true; mfaChallengeToken: string }> {
    const result = await this.db.query<{
      id: string;
      email: string;
      password_hash: string;
      full_name: string;
      is_active: boolean;
    }>(
      'SELECT id, email, password_hash, full_name, is_active FROM users WHERE email = $1',
      [dto.email.toLowerCase()],
    );

    const user = result.rows[0];
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.is_active) {
      throw new UnauthorizedException('Account is deactivated');
    }

    const valid = await bcrypt.compare(dto.password, user.password_hash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const membership = await this.getUserMembership(user.id, dto.companyId);
    const mfaStatus = await this.mfaService.status(user.id);
    if (mfaStatus.enabled) return this.createMfaChallenge(user.id, user.email, membership.companyId);

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      companyId: membership.companyId,
      branchId: membership.branchId,
      role: membership.role,
    };

    return {
      accessToken: this.issueToken(payload, false),
      refreshToken: await this.issueTrackedRefreshToken(payload),
      user: {
        userId: user.id,
        email: user.email,
        fullName: user.full_name,
        companyId: membership.companyId,
        branchId: membership.branchId,
        role: membership.role,
      },
    };
  }

  private createMfaChallenge(userId: string, email: string, companyId?: string | null): { mfaRequired: true; mfaChallengeToken: string } {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is missing from the environment.');
    return {
      mfaRequired: true,
      mfaChallengeToken: this.jwtService.sign({ sub: userId, email, ...(companyId ? { companyId } : {}), mfaChallenge: true }, { secret, expiresIn: '5m' }),
    };
  }

  async completeMfaChallenge(challengeToken: string, code: string): Promise<TokenPair & { user: Omit<AuthenticatedUser, 'permissions'> }> {
    let challenge: { sub: string; email: string; companyId?: string; mfaChallenge?: boolean };
    try {
      challenge = this.jwtService.verify(challengeToken, { secret: process.env.JWT_SECRET });
    } catch {
      throw new UnauthorizedException('MFA challenge expired or invalid. Please sign in again.');
    }
    if (challenge.mfaChallenge !== true || !challenge.sub || !challenge.email) {
      throw new UnauthorizedException('Invalid MFA challenge.');
    }
    const valid = (await this.mfaService.verifyUserCode(challenge.sub, code)) ||
      (await this.mfaService.useRecoveryCode(challenge.sub, code));
    if (!valid) throw new UnauthorizedException('Invalid authenticator or recovery code.');
    const profile = await this.getUserProfile(challenge.sub, challenge.companyId);
    const payload: JwtPayload = {
      sub: profile.userId, email: profile.email, companyId: profile.companyId,
      branchId: profile.branchId, role: profile.role, mfaVerified: true,
    };
    return {
      accessToken: this.issueToken(payload, false),
      refreshToken: await this.issueTrackedRefreshToken(payload),
      user: {
        userId: profile.userId, email: profile.email, fullName: profile.fullName,
        companyId: profile.companyId, branchId: profile.branchId, role: profile.role,
      },
    };
  }

  async refresh(dto: RefreshDto): Promise<TokenPair> {
    try {
      const payload = this.jwtService.verify<JwtPayload & { jti?: string; familyId?: string }>(dto.refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
      if (!payload.jti || !payload.familyId) throw new UnauthorizedException('Refresh token is not registered.');

      const mfaStatus = await this.mfaService.status(payload.sub);
      if (mfaStatus.enabled && payload.mfaVerified !== true) {
        throw new UnauthorizedException('Sign in again and complete MFA before refreshing tokens.');
      }
      const profile = await this.getUserProfile(payload.sub, payload.companyId);
      const newPayload: JwtPayload = {
        sub: profile.userId, email: profile.email, companyId: profile.companyId,
        branchId: profile.branchId, role: profile.role,
        ...(payload.mfaVerified === true ? { mfaVerified: true } : {}),
      };
      const nextJti = uuidv4();
      const nextToken = this.issueToken({ ...newPayload, jti: nextJti, familyId: payload.familyId } as JwtPayload, true);
      const decoded = this.jwtService.decode(nextToken) as { exp?: number } | null;
      if (!decoded?.exp) throw new Error('Could not determine refresh-token expiry.');
      const oldHash = createHash('sha256').update(dto.refreshToken).digest('hex');
      const nextHash = createHash('sha256').update(nextToken).digest('hex');
      const nextExpiry = new Date(decoded.exp * 1000);

      const outcome = await this.db.transaction(async (client) => {
        const current = await client.query<{ token_family_id: string; used_at: Date | null; revoked_at: Date | null; expires_at: Date }>(
          'SELECT token_family_id, used_at, revoked_at, expires_at FROM auth_refresh_tokens WHERE jti = $1 AND token_hash = $2 FOR UPDATE',
          [payload.jti, oldHash],
        );
        const row = current.rows[0];
        if (!row || row.token_family_id !== payload.familyId || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
          return 'invalid' as const;
        }
        if (row.used_at) {
          await client.query(
            'UPDATE auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW() WHERE token_family_id = $1',
            [payload.familyId],
          );
          return 'reuse' as const;
        }
        await client.query('UPDATE auth_refresh_tokens SET used_at = NOW(), updated_at = NOW() WHERE jti = $1', [payload.jti]);
        await client.query(
          'INSERT INTO auth_refresh_tokens (jti, token_hash, token_family_id, user_id, company_id, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [nextJti, nextHash, payload.familyId, profile.userId, profile.companyId, nextExpiry],
        );
        return 'rotated' as const;
      });
      if (outcome !== 'rotated') throw new UnauthorizedException(outcome === 'reuse' ? 'Refresh token reuse detected. Sign in again.' : 'Invalid refresh token');
      return { accessToken: this.issueToken(newPayload, false), refreshToken: nextToken };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async getActiveCompanies(userId: string): Promise<Array<{ id: string; name: string; role: string; branchId: string | null }>> {
    const result = await this.db.query<{ id: string; name: string; role: string; branch_id: string | null }>(
      `SELECT c.id, c.name, cm.role, cm.branch_id
       FROM company_memberships cm
       JOIN companies c ON c.id = cm.company_id AND c.is_active = true
       WHERE cm.user_id = $1 AND cm.is_active = true
       ORDER BY c.name, c.id`,
      [userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      branchId: row.branch_id,
    }));
  }

  async switchCompany(userId: string, companyId: string, mfaVerified = false): Promise<TokenPair & { user: Omit<AuthenticatedUser, 'permissions'> }> {
    // The target company is accepted only after an active membership check for this user.
    const profile = await this.getUserProfile(userId, companyId);
    const payload: JwtPayload = {
      sub: profile.userId,
      email: profile.email,
      companyId: profile.companyId,
      branchId: profile.branchId,
      role: profile.role,
      ...(mfaVerified ? { mfaVerified: true } : {}),
    };
    return {
      accessToken: this.issueToken(payload, false),
      refreshToken: await this.issueTrackedRefreshToken(payload),
      user: {
        userId: profile.userId,
        email: profile.email,
        fullName: profile.fullName,
        companyId: profile.companyId,
        branchId: profile.branchId,
        role: profile.role,
      },
    };
  }

  async getUserProfile(userId: string, companyId?: string | null): Promise<AuthenticatedUser> {
    const result = await this.db.query<{
      id: string;
      email: string;
      full_name: string;
      is_active: boolean;
    }>('SELECT id, email, full_name, is_active FROM users WHERE id = $1', [userId]);

    const user = result.rows[0];
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.is_active) {
      throw new UnauthorizedException('Account is deactivated');
    }

    const membership = await this.getUserMembership(user.id, companyId);
    const permissions = await this.getUserPermissions(membership.role, user.id);

    return {
      userId: user.id,
      email: user.email,
      fullName: user.full_name,
      companyId: membership.companyId,
      branchId: membership.branchId,
      role: membership.role,
      permissions,
    };
  }

  private async getUserMembership(
    userId: string,
    companyId?: string | null,
  ): Promise<{ companyId: string | null; branchId: string | null; role: string }> {
    // Fail closed for legacy/forged tokens and internal callers that omit the
    // selected company. A multi-company identity must never fall back to LIMIT 1.
    if (!companyId) {
      const activeCompanies = await this.getActiveCompanies(userId);
      if (activeCompanies.length > 1) {
        throw new UnauthorizedException('Company selection is required for this account.');
      }
    }

    const result = await this.db.query<{
      company_id: string | null;
      branch_id: string | null;
      role: string;
    }>(
      `SELECT cm.company_id, cm.branch_id, cm.role
       FROM company_memberships cm
       JOIN companies c ON c.id = cm.company_id AND c.is_active = true
       WHERE cm.user_id = $1 AND cm.is_active = true
         AND ($2::uuid IS NULL OR cm.company_id = $2::uuid)
       ORDER BY cm.company_id
       LIMIT 1`,
      [userId, companyId ?? null],
    );

    if (result.rows.length === 0) {
      throw new UnauthorizedException('This account has no active company membership. Contact your administrator.');
    }

    const m = result.rows[0];
    return {
      companyId: m.company_id,
      branchId: m.branch_id,
      role: m.role,
    };
  }

  private async getUserPermissions(role: string, _userId: string): Promise<string[]> {
    const result = await this.db.query<{ permission: string }>(
      `SELECT p.permission
       FROM role_permissions rp
       JOIN permissions p ON rp.permission_id = p.id
       WHERE rp.role = $1`,
      [role],
    );

    return result.rows.map((r) => r.permission);
  }

  private async issueTrackedRefreshToken(payload: JwtPayload): Promise<string> {
    const jti = uuidv4();
    const familyId = uuidv4();
    const token = this.issueToken({ ...payload, jti, familyId } as JwtPayload, true);
    const decoded = this.jwtService.decode(token) as { exp?: number } | null;
    if (!decoded?.exp) throw new Error('Could not determine refresh-token expiry.');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await this.db.query(
      'INSERT INTO auth_refresh_tokens (jti, token_hash, token_family_id, user_id, company_id, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [jti, tokenHash, familyId, payload.sub, payload.companyId, new Date(decoded.exp * 1000)],
    );
    return token;
  }

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    try {
      const payload = this.jwtService.verify<JwtPayload & { jti?: string; familyId?: string }>(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
      if (!payload.jti || !payload.familyId) return;
      const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
      await this.db.query(
        'UPDATE auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW() WHERE token_family_id = $1 AND jti = $2 AND token_hash = $3',
        [payload.familyId, payload.jti, tokenHash],
      );
      await this.db.query(
        'UPDATE auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW() WHERE token_family_id = $1',
        [payload.familyId],
      );
    } catch {
      // Logout is intentionally idempotent and does not reveal token validity.
    }
  }
  private issueToken(payload: JwtPayload, isRefresh: boolean): string {
    const secret = isRefresh ? process.env.JWT_REFRESH_SECRET : process.env.JWT_SECRET;
    const expiresIn = isRefresh
      ? process.env.JWT_REFRESH_EXPIRES_IN || '7d'
      : process.env.JWT_EXPIRES_IN || '15m';

    return this.jwtService.sign(payload as unknown as object, {
      secret,
      expiresIn: expiresIn as unknown as number,
    });
  }
}
