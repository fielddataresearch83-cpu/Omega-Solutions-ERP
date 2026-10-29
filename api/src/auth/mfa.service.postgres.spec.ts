import { randomUUID, createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { MfaService } from './mfa.service.js';

const connectionString = process.env.MFA_TEST_DATABASE_URL;
const suite = describe.skipIf(!connectionString);

suite('MfaService recovery-code PostgreSQL concurrency', () => {
  const pool = new Pool({ connectionString });
  const userId = `mfa-concurrency-${randomUUID()}`;
  let service: MfaService;

  beforeAll(async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.user_mfa (
        user_id text PRIMARY KEY,
        secret_encrypted text,
        pending_secret_encrypted text,
        enabled_at timestamptz,
        recovery_code_hashes text[] NOT NULL DEFAULT '{}',
        failed_attempts integer NOT NULL DEFAULT 0,
        locked_until timestamptz,
        updated_at timestamptz NOT NULL DEFAULT NOW()
      )
    `);
    service = new MfaService({
      query: async (sql: string, params?: unknown[]) => {
        const result = await pool.query(sql, params as any[]);
        return { rows: result.rows, rowCount: result.rowCount };
      },
    } as any);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM public.user_mfa WHERE user_id = $1', [userId]);
    await pool.end();
  });

  it('consumes two different recovery codes concurrently without restoring either code', async () => {
    const first = 'A1B2C3D4';
    const second = 'E5F6A7B8';
    const hash = (code: string) => createHash('sha256').update(code).digest('hex');
    await pool.query(
      `INSERT INTO public.user_mfa
         (user_id, enabled_at, recovery_code_hashes)
       VALUES ($1, NOW(), $2::text[])`,
      [userId, [hash(first), hash(second)]],
    );

    // Force both calls to finish their initial read before either conditional
    // UPDATE runs. This recreates the stale-array interleaving deterministically.
    let readers = 0;
    let releaseReaders!: () => void;
    const bothRead = new Promise<void>((resolve) => { releaseReaders = resolve; });
    const barrierDb = {
      query: async (sql: string, params?: unknown[]) => {
        const result = await pool.query(sql, params as any[]);
        if (sql.includes('SELECT recovery_code_hashes, locked_until FROM user_mfa')) {
          readers += 1;
          if (readers === 2) releaseReaders();
          await bothRead;
        }
        return { rows: result.rows, rowCount: result.rowCount };
      },
    };
    const concurrentService = new MfaService(barrierDb as any);

    const results = await Promise.all([
      concurrentService.useRecoveryCode(userId, first),
      concurrentService.useRecoveryCode(userId, second),
    ]);
    const remaining = await pool.query<{ recovery_code_hashes: string[] }>(
      'SELECT recovery_code_hashes FROM public.user_mfa WHERE user_id = $1',
      [userId],
    );

    expect(results).toEqual([true, true]);
    expect(remaining.rows[0]?.recovery_code_hashes).toEqual([]);
  });

  it('allows a recovery code to be consumed only once when submitted concurrently', async () => {
    await pool.query('DELETE FROM public.user_mfa WHERE user_id = $1', [userId]);
    const code = '11223344';
    const hash = createHash('sha256').update(code).digest('hex');
    await pool.query(
      `INSERT INTO public.user_mfa
         (user_id, enabled_at, recovery_code_hashes)
       VALUES ($1, NOW(), $2::text[])`,
      [userId, [hash]],
    );

    const results = await Promise.all([
      service.useRecoveryCode(userId, code),
      service.useRecoveryCode(userId, code),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const remaining = await pool.query<{ recovery_code_hashes: string[] }>(
      'SELECT recovery_code_hashes FROM public.user_mfa WHERE user_id = $1',
      [userId],
    );
    expect(remaining.rows[0]?.recovery_code_hashes).toEqual([]);
  });
});
