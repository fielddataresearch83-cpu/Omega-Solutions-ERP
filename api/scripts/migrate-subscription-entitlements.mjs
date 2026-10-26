import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../src/migrations');
const connectionString = process.env.DATABASE_URL;
const migrations = [
  { filename: '042_subscription_module_entitlements.sql', requiredTables: ['subscription_plans', 'company_subscriptions', 'subscription_change_requests', 'company_module_overrides'] },
  { filename: '043_subscription_module_requests.sql', requiredTables: ['subscription_module_requests'] },
  { filename: '202610260004_subscription_tier_restructure.sql', requiredTables: ['subscription_plans', 'company_subscriptions', 'subscription_change_requests', 'company_module_overrides'] },
];
if (!connectionString) throw new Error('DATABASE_URL is required to apply subscription migrations.');
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
  for (const migration of migrations) {
    const sql = await readFile(path.join(migrationsDir, migration.filename), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = await client.query('SELECT checksum FROM omega_schema_migrations WHERE filename = $1', [migration.filename]);
    if (existing.rowCount && existing.rows[0].checksum !== checksum) {
      throw new Error(`Migration ${migration.filename} checksum mismatch. Refusing to change an already-recorded migration.`);
    }
    const tableResult = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [migration.requiredTables],
    );
    const present = new Set(tableResult.rows.map((row) => row.table_name));
    if (existing.rowCount && present.size === migration.requiredTables.length) {
      console.log(`✓ ${migration.filename} already applied and required tables are present`);
      continue;
    }
    console.log(`→ Applying ${migration.filename} without replaying unrelated historical migrations`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        `INSERT INTO omega_schema_migrations (filename, checksum)
         VALUES ($1, $2)
         ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = NOW()`,
        [migration.filename, checksum],
      );
      await client.query('COMMIT');
      console.log(`✓ ${migration.filename} applied`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  const verification = await client.query(
    `SELECT
       (SELECT count(*)::int FROM subscription_plans WHERE code IN ('starter','medium','professional','enterprise_custom') AND is_active = TRUE) AS active_plan_count,
       (SELECT count(*)::int FROM subscription_plans WHERE code = 'enterprise_custom' AND is_custom_pricing = TRUE) AS custom_plan_count,
       (SELECT count(*)::int FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])) AS table_count`,
    [['subscription_plans', 'company_subscriptions', 'subscription_change_requests', 'company_module_overrides', 'subscription_module_requests']],
  );
  if (verification.rows[0].active_plan_count !== 4 || verification.rows[0].custom_plan_count !== 1 || verification.rows[0].table_count !== 5) {
    throw new Error('Subscription schema verification failed; expected five tables, four active tiers, and one custom-priced Enterprise plan.');
  }
  console.log('Subscription schema verified: 5 tables, four active tiers, custom-priced Enterprise. No company subscriptions were assigned.');
} finally {
  await client.end();
}
