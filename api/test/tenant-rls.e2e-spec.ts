import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';

const connectionString = process.env.DATABASE_URL;
const suite = describe.skipIf(!connectionString);

suite('PostgreSQL tenant RLS isolation contract', () => {
  const suffix = randomUUID().replaceAll('-', '');
  const schema = `omega_rls_test_${suffix}`;
  const role = `omega_rls_role_${suffix}`;
  const companyA = '11111111-1111-4111-8111-111111111111';
  const companyB = '22222222-2222-4222-8222-222222222222';
  const pool = new Pool({ connectionString, max: 1 });

  async function asTenant<T>(
    companyId: string | null,
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE "${role}"`);
      if (companyId) {
        await client.query("SELECT set_config('omega.company_id', $1, true)", [companyId]);
      }
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
    await pool.query(`CREATE ROLE "${role}" NOLOGIN NOBYPASSRLS`);
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`
      CREATE TABLE "${schema}".tenant_records (
        id uuid PRIMARY KEY,
        company_id uuid NOT NULL,
        payload text NOT NULL
      )
    `);
    await pool.query(`ALTER TABLE "${schema}".tenant_records ENABLE ROW LEVEL SECURITY`);
    await pool.query(`ALTER TABLE "${schema}".tenant_records FORCE ROW LEVEL SECURITY`);
    await pool.query(`
      CREATE POLICY tenant_company_isolation
      ON "${schema}".tenant_records
      USING (company_id = NULLIF(current_setting('omega.company_id', true), '')::uuid)
      WITH CHECK (company_id = NULLIF(current_setting('omega.company_id', true), '')::uuid)
    `);
    await pool.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
    await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${schema}".tenant_records TO "${role}"`);
  });

  afterAll(async () => {
    try {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.query(`DROP ROLE IF EXISTS "${role}"`);
    } finally {
      await pool.end();
    }
  });

  it('fails closed when the transaction has no company context', async () => {
    const visible = await asTenant(null, async (client) =>
      client.query(`SELECT id FROM "${schema}".tenant_records`),
    );
    expect(visible.rows).toHaveLength(0);

    await expect(asTenant(null, (client) =>
      client.query(`
        INSERT INTO "${schema}".tenant_records (id, company_id, payload)
        VALUES ($1, $2, 'no-context')
      `, [randomUUID(), companyA]),
    )).rejects.toMatchObject({ code: '42501' });
  });

  it('isolates reads and writes between two companies', async () => {
    const idA = randomUUID();
    const idB = randomUUID();

    await asTenant(companyA, (client) =>
      client.query(`
        INSERT INTO "${schema}".tenant_records (id, company_id, payload)
        VALUES ($1, $2, 'company-a')
      `, [idA, companyA]),
    );
    await asTenant(companyB, (client) =>
      client.query(`
        INSERT INTO "${schema}".tenant_records (id, company_id, payload)
        VALUES ($1, $2, 'company-b')
      `, [idB, companyB]),
    );

    const aRows = await asTenant(companyA, (client) =>
      client.query(`SELECT id, payload FROM "${schema}".tenant_records`),
    );
    const bRows = await asTenant(companyB, (client) =>
      client.query(`SELECT id, payload FROM "${schema}".tenant_records`),
    );

    expect(aRows.rows).toEqual([{ id: idA, payload: 'company-a' }]);
    expect(bRows.rows).toEqual([{ id: idB, payload: 'company-b' }]);

    const crossCompanyUpdate = await asTenant(companyA, (client) =>
      client.query(`
        UPDATE "${schema}".tenant_records SET payload = 'tampered'
        WHERE id = $1
      `, [idB]),
    );
    expect(crossCompanyUpdate.rowCount).toBe(0);

    await expect(asTenant(companyA, (client) =>
      client.query(`
        INSERT INTO "${schema}".tenant_records (id, company_id, payload)
        VALUES ($1, $2, 'forged-company')
      `, [randomUUID(), companyB]),
    )).rejects.toMatchObject({ code: '42501' });
  });

  it('does not leak transaction-local company context when a pooled connection is reused', async () => {
    await asTenant(companyA, async (client) => {
      const current = await client.query<{ company_id: string }>(
        "SELECT current_setting('omega.company_id', true) AS company_id",
      );
      expect(current.rows[0]?.company_id).toBe(companyA);
    });

    const next = await pool.query<{ company_id: string | null }>(
      "SELECT NULLIF(current_setting('omega.company_id', true), '') AS company_id",
    );
    expect(next.rows[0]?.company_id ?? null).toBeNull();
  });
});
