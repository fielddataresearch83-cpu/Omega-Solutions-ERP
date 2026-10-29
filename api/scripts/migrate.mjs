import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { compareMigrationNames, findMigrationLedgerGaps } from './migration-order.mjs';

const { Client } = pg;
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../src/migrations');
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required to run database migrations.');
}

const client = new Client({
  connectionString,
  ssl: connectionString.includes('neon.tech') ? { rejectUnauthorized: true } : undefined,
});

try {
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS omega_schema_migrations (
      filename TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = (await readdir(migrationsDir))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
    .sort(compareMigrationNames);

  // Refuse unsafe automatic catch-up when older migration files are absent
  // from the ledger but later files are recorded. Some historical migrations
  // contain data-changing UPDATEs; schema presence alone is not proof that
  // re-running them is safe. Reconcile such databases with a reviewed plan.
  const appliedResult = await client.query('SELECT filename FROM omega_schema_migrations');
  const appliedFilenames = appliedResult.rows.map((row) => row.filename);
  if (appliedFilenames.length === 0) {
    const existingTables = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type = 'BASE TABLE'
         AND table_name <> 'omega_schema_migrations'`,
    );
    if (Number(existingTables.rows[0]?.count ?? 0) > 0) {
      throw new Error(
        'Refusing automatic migration: application tables exist but the migration ledger is empty. Reconcile the existing schema and ledger before retrying.',
      );
    }
  }
  const ledgerGaps = findMigrationLedgerGaps(files, appliedFilenames);
  if (ledgerGaps.length > 0) {
    throw new Error(
      `Refusing automatic migration: the ledger has ${ledgerGaps.length} unapplied migration(s) before later applied migrations: ${ledgerGaps.slice(0, 12).join(', ')}${ledgerGaps.length > 12 ? ', …' : ''}. Reconcile the existing schema and migration ledger before retrying.`,
    );
  }

  for (const filename of files) {
    const sql = await readFile(path.join(migrationsDir, filename), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = await client.query(
      'SELECT checksum FROM omega_schema_migrations WHERE filename = $1',
      [filename],
    );

    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(
          `Migration ${filename} was modified after application. Add a new migration instead.`,
        );
      }
      console.log(`✓ ${filename} already applied`);
      continue;
    }

    console.log(`→ Applying ${filename}`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO omega_schema_migrations (filename, checksum) VALUES ($1, $2)',
        [filename, checksum],
      );
      await client.query('COMMIT');
      console.log(`✓ ${filename} applied`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  console.log('Database migrations are up to date.');
} finally {
  await client.end();
}
