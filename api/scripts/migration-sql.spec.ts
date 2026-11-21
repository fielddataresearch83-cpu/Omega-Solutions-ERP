import { describe, expect, it, vi } from 'vitest';
import { applyMigrationTransaction, stripTopLevelTransactionWrappers } from './migration-sql.mjs';

describe('stripTopLevelTransactionWrappers', () => {
  it('removes top-level BEGIN/COMMIT with optional modifiers and comments', () => {
    const sql = `-- migration wrapper\nBEGIN WORK;\nCREATE TABLE example (id integer);\nCOMMIT TRANSACTION;`;
    expect(stripTopLevelTransactionWrappers(sql)).toContain('CREATE TABLE example');
    expect(stripTopLevelTransactionWrappers(sql)).not.toMatch(/\b(?:BEGIN|COMMIT)\s+(?:WORK|TRANSACTION)?\s*;/i);
  });

  it('recognizes wrappers surrounded by nested block comments', () => {
    const sql = `/* outer /* nested */ comment */ BEGIN;\nSELECT 1;\n/* final wrapper */ COMMIT;`;
    const execution = stripTopLevelTransactionWrappers(sql);
    expect(execution).toContain('SELECT 1;');
    expect(execution).not.toMatch(/\b(?:BEGIN|COMMIT)\s*;/i);
  });

  it('preserves BEGIN/COMMIT inside dollar-quoted procedural bodies', () => {
    const sql = `BEGIN;\nDO $body$ BEGIN PERFORM 1; COMMIT; END $body$;\nCOMMIT;`;
    expect(stripTopLevelTransactionWrappers(sql)).toContain('DO $body$ BEGIN PERFORM 1; COMMIT; END $body$;');
  });

  it('preserves transaction keywords in strings, identifiers and comments', () => {
    const sql = `BEGIN;\nSELECT 'COMMIT; BEGIN', "BEGIN", 1; -- COMMIT;\n/* BEGIN; /* COMMIT; */ still comment */\nCOMMIT;`;
    expect(stripTopLevelTransactionWrappers(sql)).toContain("SELECT 'COMMIT; BEGIN', \"BEGIN\", 1;");
    expect(stripTopLevelTransactionWrappers(sql)).toContain('-- COMMIT;');
    expect(stripTopLevelTransactionWrappers(sql)).toContain('/* BEGIN; /* COMMIT; */ still comment */');
  });

  it('does not remove transaction-like words in larger statements', () => {
    const sql = `BEGIN;\nBEGINNING;\nCOMMITMENT;\nCOMMIT;`;
    expect(stripTopLevelTransactionWrappers(sql)).toContain('BEGINNING;\nCOMMITMENT;');
  });
});

describe('applyMigrationTransaction', () => {
  it('keeps migration SQL and its ledger insert inside one transaction', async () => {
    const calls: unknown[][] = [];
    const client = { query: vi.fn(async (...args: unknown[]) => { calls.push(args); return {}; }) };
    await applyMigrationTransaction(client as never, '001_example.sql', 'BEGIN; SELECT 1; COMMIT;', 'abc123');
    expect(calls.map(([query]) => query)).toEqual([
      'BEGIN', ' SELECT 1;',
      'INSERT INTO omega_schema_migrations (filename, checksum) VALUES ($1, $2)', 'COMMIT',
    ]);
    expect(calls[2]).toEqual([
      'INSERT INTO omega_schema_migrations (filename, checksum) VALUES ($1, $2)',
      ['001_example.sql', 'abc123'],
    ]);
  });

  it('rolls back and never inserts the ledger row when migration SQL fails', async () => {
    const failure = new Error('migration failed');
    const client = { query: vi.fn(async (query: string) => {
      if (query.includes('BROKEN')) throw failure;
      return {};
    }) };
    await expect(applyMigrationTransaction(client as never, '002_broken.sql', 'BROKEN;', 'def456')).rejects.toBe(failure);
    expect(client.query.mock.calls.map(([query]) => query)).toEqual(['BEGIN', 'BROKEN;', 'ROLLBACK']);
  });
});
