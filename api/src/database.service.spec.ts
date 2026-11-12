import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { client, pool } = vi.hoisted(() => {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(),
    query: vi.fn(),
    end: vi.fn(),
  };
  return { client, pool };
});

vi.mock('pg', () => ({
  Pool: vi.fn(function () {
    return pool;
  }),
}));

import { DatabaseService } from './database.service.js';
import { tenantDatabaseContext } from './database/tenant-database-context.js';

describe('DatabaseService transaction boundary', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgres://unit-test:unit-test@localhost:5432/unit_test');
    vi.clearAllMocks();
    pool.connect.mockResolvedValue(client);
    client.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('commits successful callbacks and always releases the client', async () => {
    const db = new DatabaseService();
    const callback = vi.fn().mockResolvedValue({ saved: true });

    await expect(db.transaction(callback)).resolves.toEqual({ saved: true });

    expect(pool.connect).toHaveBeenCalledOnce();
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'COMMIT']);
    expect(callback).toHaveBeenCalledWith(client);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back callback failures, rethrows the original error, and releases the client', async () => {
    const db = new DatabaseService();
    const failure = new Error('simulated write failure');
    const callback = vi.fn().mockRejectedValue(failure);

    await expect(db.transaction(callback)).rejects.toBe(failure);

    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back commit failures and releases the client', async () => {
    const db = new DatabaseService();
    const failure = new Error('simulated commit failure');
    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'COMMIT') throw failure;
      return { rows: [], rowCount: 0 };
    });

    await expect(db.transaction(async () => 'result')).rejects.toBe(failure);

    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'COMMIT', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('preserves the original failure and discards the client if rollback also fails', async () => {
    const db = new DatabaseService();
    const operationFailure = new Error('simulated write failure');
    const rollbackFailure = new Error('simulated rollback failure');
    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'ROLLBACK') throw rollbackFailure;
      return { rows: [], rowCount: 0 };
    });
    const callback = vi.fn().mockRejectedValue(operationFailure);

    await expect(db.transaction(callback)).rejects.toBe(operationFailure);

    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledWith(rollbackFailure);
  });

  it('sets verified tenant context transaction-locally for authenticated queries', async () => {
    const db = new DatabaseService();
    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'SELECT 42') return { rows: [{ value: 42 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const result = await tenantDatabaseContext.run(
      { userId: 'user-1', companyId: 'company-1', branchId: 'branch-1' },
      () => db.query('SELECT 42'),
    );

    expect(result.rows).toEqual([{ value: 42 }]);
    expect(pool.query).not.toHaveBeenCalled();
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining("set_config('app.user_id'"),
      'SELECT 42',
      'COMMIT',
    ]);
    expect(client.query.mock.calls[1][1]).toEqual(['user-1', 'company-1', 'branch-1']);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('sets verified tenant context before callback SQL in managed transactions', async () => {
    const db = new DatabaseService();
    const callback = vi.fn(async (tx: typeof client) => {
      await tx.query('SELECT 1');
      return 'ok';
    });

    await tenantDatabaseContext.run(
      { userId: 'user-2', companyId: 'company-2', branchId: null },
      () => db.transaction(callback),
    );

    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining("set_config('app.user_id'"),
      'SELECT 1',
      'COMMIT',
    ]);
    expect(client.query.mock.calls[1][1]).toEqual(['user-2', 'company-2', '']);
  });

  it('does not try to roll back if acquiring a client fails', async () => {
    const db = new DatabaseService();
    const failure = new Error('pool unavailable');
    pool.connect.mockRejectedValue(failure);

    await expect(db.transaction(async () => 'result')).rejects.toBe(failure);

    expect(client.query).not.toHaveBeenCalled();
    expect(client.release).not.toHaveBeenCalled();
  });
});
