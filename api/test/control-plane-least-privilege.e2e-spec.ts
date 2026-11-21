import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';

/**
 * Proves the least-privilege grants in 202611210001_control_plane_least_privilege.sql
 * against a real PostgreSQL server, using a NOBYPASSRLS role that simulates the
 * future runtime identity.
 *
 * Safety: runs only against a local disposable *_test database that already has
 * the migrated schema, and only when it can create the `omega_app_dev` role
 * itself. If that role already exists (a real environment), the suite skips
 * rather than mutating privileges it cannot restore.
 */
const connectionString = process.env.DATABASE_URL;
const isDisposableLocalDatabase = (() => {
  if (!connectionString) return false;
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(connectionString).hostname);
  } catch {
    return false;
  }
})();

const pool = new Pool({ connectionString, max: 2 });
const migrationsApplied = await (async () => {
  if (!isDisposableLocalDatabase) return false;
  try {
    const result = await pool.query(
      "SELECT to_regclass('public.permissions') IS NOT NULL AS permissions, to_regclass('public.omega_schema_migrations') IS NOT NULL AS ledger",
    );
    return Boolean(result.rows[0]?.permissions && result.rows[0]?.ledger);
  } catch {
    return false;
  }
})();

// Only run where this suite can own the role lifecycle; never mutate a real role.
const roleAbsent = await (async () => {
  if (!migrationsApplied) return false;
  try {
    const result = await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', ['omega_app_dev']);
    return !result.rowCount;
  } catch {
    return false;
  }
})();

const suite = describe.skipIf(!migrationsApplied || !roleAbsent);
const appRole = 'omega_app_dev';
let createdRole = false;

async function asAppRole<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE "${appRole}"`);
    const result = await callback(client);
    await client.query('ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

suite('Control-plane least-privilege grants', () => {
  beforeAll(async () => {
    await pool.query(`CREATE ROLE "${appRole}" NOLOGIN NOBYPASSRLS`);
    createdRole = true;
    await pool.query(`GRANT "${appRole}" TO CURRENT_USER`);

    // Simulate the pre-hardening state: a runtime role that could read and write
    // everything, including the ledger.
    await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.permissions, public.role_permissions, public.subscription_plans TO "${appRole}"`);
    await pool.query(`GRANT SELECT ON public.omega_schema_migrations TO "${appRole}"`);
    await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_rate_limits TO "${appRole}"`);

    const migration = readFileSync(
      resolve(process.cwd(), 'src/migrations/202611210001_control_plane_least_privilege.sql'),
      'utf8',
    );
    await pool.query(migration);
  }, 30_000);

  afterAll(async () => {
    try {
      if (createdRole) {
        await pool.query(`REVOKE "${appRole}" FROM CURRENT_USER`).catch(() => undefined);
        await pool.query(`DROP OWNED BY "${appRole}"`).catch(() => undefined);
        await pool.query(`DROP ROLE IF EXISTS "${appRole}"`);
      }
    } finally {
      await pool.end();
    }
  });

  it('still lets the application read the global catalogs it depends on', async () => {
    const permissions = await asAppRole(client => client.query('SELECT permission FROM public.permissions LIMIT 1'));
    expect(permissions.rowCount).toBeGreaterThan(0);
    const plans = await asAppRole(client => client.query('SELECT code FROM public.subscription_plans'));
    expect(plans.rowCount).toBeGreaterThan(0);
    const mapping = await asAppRole(client => client.query('SELECT role, permission_id FROM public.role_permissions LIMIT 1'));
    expect(mapping.rowCount).toBeGreaterThan(0);
  });

  it.each([
    ['permissions', `INSERT INTO public.permissions(id, permission) VALUES (gen_random_uuid(), 'forged:permission')`],
    ['role_permissions', `DELETE FROM public.role_permissions WHERE role = 'staff'`],
    ['subscription_plans', `UPDATE public.subscription_plans SET name = 'tampered'`],
  ])('refuses writes to %s from the runtime role', async (_table, statement) => {
    await expect(asAppRole(client => client.query(statement))).rejects.toMatchObject({ code: '42501' });
  });

  it('denies all reads of the migration ledger', async () => {
    await expect(asAppRole(client => client.query('SELECT filename FROM public.omega_schema_migrations'))).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('keeps the auth throttle writable, because the login path depends on it', async () => {
    const keyHash = randomUUID().replaceAll('-', '');
    // Write and read in one transaction: the helper rolls back by design.
    const result = await asAppRole(async client => {
      const write = await client.query(
        `INSERT INTO public.auth_rate_limits(key_hash, window_started_at, request_count)
         VALUES ($1, date_trunc('minute', NOW()), 1)
         ON CONFLICT (key_hash, window_started_at) DO UPDATE SET request_count = public.auth_rate_limits.request_count + 1
         RETURNING request_count`,
        [keyHash],
      );
      const read = await client.query('SELECT request_count FROM public.auth_rate_limits WHERE key_hash = $1', [keyHash]);
      return { written: write.rows[0].request_count, read: read.rows[0]?.request_count };
    });
    expect(result).toEqual({ written: 1, read: 1 });
  });
});
