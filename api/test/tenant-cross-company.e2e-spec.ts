import { randomUUID, createHash } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { getLocalDisposableTestDatabaseUrl } from './helpers/disposable-database.js';

/**
 * Application-layer tenant isolation and role-boundary regression tests (SEC-02, SEC-05, SEC-07).
 *
 * These run against a real PostgreSQL database with the full migration set applied and the real
 * Nest application booted, so they exercise the actual guards, JWT strategy, membership lookup and
 * SQL predicates. The connection is the CI superuser, which bypasses RLS on purpose: the point of
 * this suite is to prove the application layer also scopes tenancy, independently of RLS.
 *
 * Requires: OMEGA_TEST_DATABASE_URL pointing at a local *_test database with all migrations applied.
 * This suite must run BEFORE test/application-rls.e2e-spec.ts, which fabricates and drops
 * public.company_memberships. CI uses a separate database for that suite to avoid relying on order.
 */

const testDatabaseUrl = getLocalDisposableTestDatabaseUrl();
const suite = testDatabaseUrl ? describe : describe.skip;
const JWT_SECRET = 'test-only-cross-company-jwt-secret-32-chars-min';

const COMPANY_A = 'a1000000-0000-4000-8000-000000000001';
const COMPANY_B = 'b1000000-0000-4000-8000-000000000002';
const BRANCH_A1 = 'a1000000-0000-4000-8000-0000000000b1';
const OWNER_A = 'a2000000-0000-4000-8000-000000000001';
const STAFF_A = 'a2000000-0000-4000-8000-000000000002';
const BRANCH_ADMIN_A = 'a2000000-0000-4000-8000-000000000003';
const ADMIN_A = 'a2000000-0000-4000-8000-000000000004';
const OWNER_B = 'b2000000-0000-4000-8000-000000000002';
const CUSTOMER_A = 'a3000000-0000-4000-8000-000000000001';
const CUSTOMER_B = 'b3000000-0000-4000-8000-000000000002';
const MEMBERSHIP_OWNER_B = 'b4000000-0000-4000-8000-000000000002';

type Session = { userId: string; companyId: string; branchId: string | null; role: string; email: string };

suite('Cross-company and role isolation (application layer, real PostgreSQL)', () => {
  let app: INestApplication;
  let pool: Pool;
  const jwt = new JwtService({});
  const sessions: Record<string, string> = {};

  async function issueToken(session: Session): Promise<string> {
    const familyId = randomUUID();
    const jti = randomUUID();
    await pool.query(
      `INSERT INTO auth_refresh_tokens (jti, token_hash, token_family_id, user_id, company_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '1 hour')`,
      [jti, createHash('sha256').update(`${session.userId}:${familyId}`).digest('hex'), familyId, session.userId, session.companyId],
    );
    return jwt.sign(
      {
        sub: session.userId,
        email: session.email,
        companyId: session.companyId,
        branchId: session.branchId,
        role: session.role,
        familyId,
        mfaVerified: false,
      },
      { secret: JWT_SECRET, algorithm: 'HS256', expiresIn: '15m' },
    );
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_REFRESH_SECRET ??= 'test-only-cross-company-refresh-secret-32-chars';
    pool = new Pool({ connectionString: testDatabaseUrl, max: 2 });

    const schemaReady = await pool.query("SELECT to_regclass('public.company_memberships') AS name");
    if (!schemaReady.rows[0]?.name) {
      throw new Error(
        'Cross-company suite requires the full schema. Run it against a freshly migrated database and before application-rls.e2e-spec.ts (which drops public.company_memberships).',
      );
    }

    // Clean any residue from a previous failed run so the suite is repeatable.
    await pool.query('DELETE FROM companies WHERE id = ANY($1::uuid[])', [[COMPANY_A, COMPANY_B]]);

    await pool.query(
      `INSERT INTO companies (id, name, currency, timezone, is_active) VALUES
         ($1, 'Omega Isolation Company A', 'KES', 'Africa/Nairobi', true),
         ($2, 'Omega Isolation Company B', 'KES', 'Africa/Nairobi', true)`,
      [COMPANY_A, COMPANY_B],
    );
    await pool.query(
      `INSERT INTO branches (id, company_id, name, code, is_active) VALUES ($1, $2, 'Nairobi HQ', 'HQ', true)`,
      [BRANCH_A1, COMPANY_A],
    );
    // Every module enabled so a 403 can only come from permission/role logic, never entitlement.
    await pool.query(
      `INSERT INTO company_subscriptions (company_id, plan_code, status, started_at, current_period_start, current_period_end)
       VALUES ($1, 'enterprise', 'active', NOW(), NOW(), NOW() + INTERVAL '30 days'),
              ($2, 'enterprise', 'active', NOW(), NOW(), NOW() + INTERVAL '30 days')`,
      [COMPANY_A, COMPANY_B],
    );
    await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name, is_active) VALUES
         ($1, 'owner-a@omega-isolation.test', 'x', 'Owner A', true),
         ($2, 'staff-a@omega-isolation.test', 'x', 'Staff A', true),
         ($3, 'branch-admin-a@omega-isolation.test', 'x', 'Branch Admin A', true),
         ($4, 'admin-a@omega-isolation.test', 'x', 'Company Admin A', true),
         ($5, 'owner-b@omega-isolation.test', 'x', 'Owner B', true)`,
      [OWNER_A, STAFF_A, BRANCH_ADMIN_A, ADMIN_A, OWNER_B],
    );
    await pool.query(
      `INSERT INTO company_memberships (id, user_id, company_id, branch_id, role, is_active) VALUES
         (gen_random_uuid(), $1, $6, NULL, 'owner', true),
         (gen_random_uuid(), $2, $6, NULL, 'staff', true),
         (gen_random_uuid(), $3, $6, $8, 'admin', true),
         (gen_random_uuid(), $4, $6, NULL, 'admin', true),
         ($9, $5, $7, NULL, 'owner', true)`,
      [OWNER_A, STAFF_A, BRANCH_ADMIN_A, ADMIN_A, OWNER_B, COMPANY_A, COMPANY_B, BRANCH_A1, MEMBERSHIP_OWNER_B],
    );
    await pool.query(
      `INSERT INTO customers (id, company_id, name, email, status, is_active) VALUES
         ($1, $3, 'Customer of Company A', 'a@omega-isolation.test', 'active', true),
         ($2, $4, 'Customer of Company B', 'b@omega-isolation.test', 'active', true)`,
      [CUSTOMER_A, CUSTOMER_B, COMPANY_A, COMPANY_B],
    );

    sessions.ownerA = await issueToken({ userId: OWNER_A, companyId: COMPANY_A, branchId: null, role: 'owner', email: 'owner-a@omega-isolation.test' });
    sessions.staffA = await issueToken({ userId: STAFF_A, companyId: COMPANY_A, branchId: null, role: 'staff', email: 'staff-a@omega-isolation.test' });
    sessions.branchAdminA = await issueToken({ userId: BRANCH_ADMIN_A, companyId: COMPANY_A, branchId: BRANCH_A1, role: 'admin', email: 'branch-admin-a@omega-isolation.test' });
    sessions.adminA = await issueToken({ userId: ADMIN_A, companyId: COMPANY_A, branchId: null, role: 'admin', email: 'admin-a@omega-isolation.test' });
    sessions.ownerB = await issueToken({ userId: OWNER_B, companyId: COMPANY_B, branchId: null, role: 'owner', email: 'owner-b@omega-isolation.test' });

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
  }, 60_000);

  afterAll(async () => {
    try {
      if (app) await app.close();
      if (pool) {
        await pool.query('DELETE FROM companies WHERE id = ANY($1::uuid[])', [[COMPANY_A, COMPANY_B]]);
        await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[OWNER_A, STAFF_A, BRANCH_ADMIN_A, ADMIN_A, OWNER_B]]);
        await pool.end();
      }
    } catch {
      // Cleanup is best-effort; the suite never targets a shared database.
    }
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('lists only the authenticated company’s customers', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/customers')
      .set(auth(sessions.ownerA))
      .expect(200);

    const ids = (response.body as Array<{ id: string }>).map((row) => row.id);
    expect(ids).toContain(CUSTOMER_A);
    expect(ids).not.toContain(CUSTOMER_B);
  });

  it('cannot read another company’s customer by direct id (BOLA)', async () => {
    await request(app.getHttpServer())
      .get(`/api/customers/${CUSTOMER_B}`)
      .set(auth(sessions.ownerA))
      .expect(404);
  });

  it('cannot update or delete another company’s customer', async () => {
    await request(app.getHttpServer())
      .patch(`/api/customers/${CUSTOMER_B}`)
      .set(auth(sessions.ownerA))
      .send({ name: 'Cross-tenant tamper' })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/customers/${CUSTOMER_B}`)
      .set(auth(sessions.ownerA))
      .expect(404);

    const untouched = await pool.query<{ name: string }>('SELECT name FROM customers WHERE id = $1', [CUSTOMER_B]);
    expect(untouched.rows[0]?.name).toBe('Customer of Company B');
  });

  it('ignores client-supplied company identifiers in query and headers', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/customers?companyId=${COMPANY_B}`)
      .set(auth(sessions.ownerA))
      .set('x-company-id', COMPANY_B)
      .expect(200);

    const ids = (response.body as Array<{ id: string }>).map((row) => row.id);
    expect(ids).toContain(CUSTOMER_A);
    expect(ids).not.toContain(CUSTOMER_B);
  });

  it('does not expose another company’s staff through the users and roles endpoint', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/users-roles')
      .set(auth(sessions.ownerA))
      .expect(200);

    const payload = JSON.stringify(response.body);
    expect(payload).toContain('owner-a@omega-isolation.test');
    expect(payload).not.toContain('owner-b@omega-isolation.test');
  });

  it('rejects a company switch to a company the user does not belong to', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/switch-company')
      .set(auth(sessions.ownerA))
      .send({ companyId: COMPANY_B })
      .expect((res) => {
        expect([401, 403]).toContain(res.status);
      });
  });

  it('enforces role permissions independently of module entitlements', async () => {
    // Positive control: the same staff token can read customers, so denials below are not blanket.
    await request(app.getHttpServer())
      .get('/api/customers')
      .set(auth(sessions.staffA))
      .expect(200);

    // Staff lacks audit:read.
    await request(app.getHttpServer())
      .get('/api/audit-logs')
      .set(auth(sessions.staffA))
      .expect(403);

    // Staff lacks users:write: it must not be able to invite members into the company.
    await request(app.getHttpServer())
      .post('/api/users-roles/invitations')
      .set(auth(sessions.staffA))
      .send({ email: 'invited-by-staff@omega-isolation.test', role: 'staff' })
      .expect(403);

    // Staff lacks branches:write even though it can read branches.
    await request(app.getHttpServer())
      .post(`/api/companies/${COMPANY_A}/branches`)
      .set(auth(sessions.staffA))
      .send({ name: 'Unauthorised branch' })
      .expect(403);
  });

  it('denies company-wide accounting to branch-bound administrators only', async () => {
    await request(app.getHttpServer())
      .get('/api/accounting/reports/trial-balance')
      .set(auth(sessions.branchAdminA))
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/accounting/reports/trial-balance')
      .set(auth(sessions.adminA))
      .expect(200);
  });

  it('keeps each company’s session scoped to its own records', async () => {
    const companyB = await request(app.getHttpServer())
      .get('/api/customers')
      .set(auth(sessions.ownerB))
      .expect(200);

    const ids = (companyB.body as Array<{ id: string }>).map((row) => row.id);
    expect(ids).toContain(CUSTOMER_B);
    expect(ids).not.toContain(CUSTOMER_A);
  });

  it('cannot suspend or change the role of another company’s membership', async () => {
    // company_memberships is deliberately outside RLS, so the application layer must scope it.
    await request(app.getHttpServer())
      .patch(`/api/users-roles/${MEMBERSHIP_OWNER_B}/status`)
      .set(auth(sessions.ownerA))
      .send({ isActive: false })
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/users-roles/${MEMBERSHIP_OWNER_B}/role`)
      .set(auth(sessions.ownerA))
      .send({ role: 'staff' })
      .expect(404);

    const membership = await pool.query<{ is_active: boolean; role: string }>(
      'SELECT is_active, role FROM company_memberships WHERE id = $1',
      [MEMBERSHIP_OWNER_B],
    );
    expect(membership.rows[0]).toEqual({ is_active: true, role: 'owner' });
  });

  it('revokes an existing session immediately when the membership is deactivated', async () => {
    await pool.query(
      'UPDATE company_memberships SET is_active = false WHERE user_id = $1 AND company_id = $2',
      [STAFF_A, COMPANY_A],
    );
    try {
      await request(app.getHttpServer())
        .get('/api/customers')
        .set(auth(sessions.staffA))
        .expect(401);
    } finally {
      await pool.query(
        'UPDATE company_memberships SET is_active = true WHERE user_id = $1 AND company_id = $2',
        [STAFF_A, COMPANY_A],
      );
    }

    // Restoring the membership must restore access for the same live session.
    await request(app.getHttpServer())
      .get('/api/customers')
      .set(auth(sessions.staffA))
      .expect(200);
  });

  it('revokes a branch-bound session when its branch is deactivated', async () => {
    await pool.query('UPDATE branches SET is_active = false WHERE id = $1', [BRANCH_A1]);
    try {
      await request(app.getHttpServer())
        .get('/api/customers')
        .set(auth(sessions.branchAdminA))
        .expect(401);
    } finally {
      await pool.query('UPDATE branches SET is_active = true WHERE id = $1', [BRANCH_A1]);
    }

    await request(app.getHttpServer())
      .get('/api/customers')
      .set(auth(sessions.branchAdminA))
      .expect(200);
  });
});
