import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';

const connectionString = process.env.DATABASE_URL;
const isDisposableLocalDatabase = (() => {
  if (!connectionString) return false;
  try {
    const url = new URL(connectionString);
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname) && url.pathname === '/omega_ci_test';
  } catch {
    return false;
  }
})();
const suite = describe.skipIf(!isDisposableLocalDatabase);

suite('Application company and branch RLS migration', () => {
  const suffix = randomUUID().replaceAll('-', '');
  const role = `omega_app_rls_${suffix}`;
  const dataTable = `omega_app_rls_data_${suffix}`;
  const companyA = '11111111-1111-4111-8111-111111111111';
  const companyB = '22222222-2222-4222-8222-222222222222';
  const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const userC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const branchA1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const branchA2 = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa';
  const pool = new Pool({ connectionString, max: 1 });
  let membershipTableCreated = false;
  let roleCreated = false;

  async function asTenant<T>(
    context: { userId?: string; companyId?: string; branchId?: string },
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE "${role}"`);
      if (context.userId) await client.query("SELECT set_config('app.user_id',$1,true)", [context.userId]);
      if (context.companyId) await client.query("SELECT set_config('app.company_id',$1,true)", [context.companyId]);
      if (context.branchId) await client.query("SELECT set_config('app.branch_id',$1,true)", [context.branchId]);
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    // Fail closed if this test is ever pointed at a non-empty or non-CI database.
    const existingMembership = await pool.query("SELECT to_regclass('public.company_memberships') AS name");
    if (existingMembership.rows[0]?.name) {
      throw new Error('Refusing to run application RLS migration test: public.company_memberships already exists. Use a fresh omega_ci_test database.');
    }

    await pool.query(`CREATE ROLE "${role}" NOLOGIN NOBYPASSRLS`);
    roleCreated = true;
    await pool.query(`GRANT "${role}" TO CURRENT_USER`);
    await pool.query(`
      CREATE TABLE public.company_memberships (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        company_id uuid NOT NULL,
        branch_id uuid,
        is_active boolean NOT NULL DEFAULT true
      )
    `);
    membershipTableCreated = true;
    await pool.query(`
      CREATE TABLE public."${dataTable}" (
        id uuid PRIMARY KEY,
        company_id uuid NOT NULL,
        branch_id uuid,
        payload text NOT NULL
      )
    `);
    await pool.query(`GRANT SELECT ON public.company_memberships TO "${role}"`);
    await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON public."${dataTable}" TO "${role}"`);

    const migration = readFileSync(
      resolve(process.cwd(), 'src/migrations/202611120004_company_rls_policies.sql'),
      'utf8',
    );
    await pool.query(migration);

    await pool.query(
      `INSERT INTO public.company_memberships(user_id,company_id,branch_id,is_active)
       VALUES ($1,$2,$3,true),($4,$5,NULL,true),($6,$2,NULL,true)`,
      [userA, companyA, branchA1, userB, companyB, userC],
    );
    await pool.query(
      `INSERT INTO public."${dataTable}"(id,company_id,branch_id,payload)
       VALUES
       ('10000000-0000-4000-8000-000000000001',$1,$2,'company-a-branch-1'),
       ('10000000-0000-4000-8000-000000000002',$1,$3,'company-a-branch-2'),
       ('10000000-0000-4000-8000-000000000003',$1,NULL,'company-a-company-wide'),
       ('20000000-0000-4000-8000-000000000001',$4,NULL,'company-b')`,
      [companyA, branchA1, branchA2, companyB],
    );
  }, 30_000);

  afterAll(async () => {
    try {
      await pool.query(`DROP TABLE IF EXISTS public."${dataTable}" CASCADE`);
      if (membershipTableCreated) await pool.query('DROP TABLE IF EXISTS public.company_memberships CASCADE');
      if (roleCreated) {
        await pool.query(`REVOKE "${role}" FROM CURRENT_USER`);
        await pool.query(`DROP ROLE IF EXISTS "${role}"`);
      }
    } finally {
      await pool.end();
    }
  });

  it('limits reads to the authenticated company and active membership', async () => {
    const result = await asTenant({ userId: userA, companyId: companyA, branchId: branchA1 }, client =>
      client.query<{ payload: string }>(`SELECT payload FROM public."${dataTable}" ORDER BY payload`),
    );
    expect(result.rows.map(row => row.payload)).toEqual(['company-a-branch-1', 'company-a-company-wide']);
  });

  it('blocks cross-company inserts and updates through the actual WITH CHECK policy', async () => {
    await expect(asTenant({ userId: userA, companyId: companyA, branchId: branchA1 }, async client => {
      await client.query(
        `INSERT INTO public."${dataTable}"(id,company_id,payload)
         VALUES ('30000000-0000-4000-8000-000000000001',$1,'forbidden')`,
        [companyB],
      );
    })).rejects.toMatchObject({ code: '42501' });

    const update = await asTenant({ userId: userA, companyId: companyA, branchId: branchA1 }, client =>
      client.query(
        `UPDATE public."${dataTable}" SET payload='tampered' WHERE company_id=$1`,
        [companyB],
      ),
    );
    expect(update.rowCount).toBe(0);
  });

  it('fails closed without tenant context and after membership deactivation', async () => {
    const withoutContext = await asTenant({}, client =>
      client.query(`SELECT id FROM public."${dataTable}"`),
    );
    expect(withoutContext.rowCount).toBe(0);

    await pool.query(
      'UPDATE public.company_memberships SET is_active=false WHERE user_id=$1 AND company_id=$2',
      [userA, companyA],
    );
    const inactive = await asTenant({ userId: userA, companyId: companyA, branchId: branchA1 }, client =>
      client.query(`SELECT id FROM public."${dataTable}"`),
    );
    expect(inactive.rowCount).toBe(0);
  });

  it('honours branch-specific and company-wide membership boundaries', async () => {
    await pool.query(
      'UPDATE public.company_memberships SET is_active=true WHERE user_id=$1 AND company_id=$2',
      [userA, companyA],
    );
    const branchSpecific = await asTenant({ userId: userA, companyId: companyA, branchId: branchA1 }, client =>
      client.query<{ payload: string }>(`SELECT payload FROM public."${dataTable}" ORDER BY payload`),
    );
    expect(branchSpecific.rows.map(row => row.payload)).toEqual(['company-a-branch-1', 'company-a-company-wide']);

    const companyWide = await asTenant({ userId: userC, companyId: companyA }, client =>
      client.query<{ payload: string }>(`SELECT payload FROM public."${dataTable}" ORDER BY payload`),
    );
    expect(companyWide.rows.map(row => row.payload)).toEqual([
      'company-a-branch-1', 'company-a-branch-2', 'company-a-company-wide',
    ]);

    const otherCompany = await asTenant({ userId: userB, companyId: companyB }, client =>
      client.query<{ payload: string }>(`SELECT payload FROM public."${dataTable}"`),
    );
    expect(otherCompany.rows.map(row => row.payload)).toEqual(['company-b']);
  });
});
