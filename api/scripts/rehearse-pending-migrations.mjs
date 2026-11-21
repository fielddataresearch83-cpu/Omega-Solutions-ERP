// Isolated rehearsal of the five migrations that the shared development ledger
// cannot contain yet (audit DB-03 / DB-04):
//
//   202611180001_manufacturing_quality_rebatch.sql
//   202611180002_inventory_batch_traceability.sql
//   202611190001_user_display_preferences.sql
//   202611190002_user_display_preferences_rls.sql
//   202611210001_control_plane_least_privilege.sql
//
// It rebuilds the schema as it exists on development *before* those files, seeds
// representative fixtures, then applies the five with the real migration runner
// and proves:
//   * inventory backfill correctness and idempotency,
//   * the rebatch availability index matches the application's status values,
//   * every new uniqueness constraint rejects duplicates,
//   * every new RLS policy isolates companies/users under a NOBYPASSRLS role,
//   * the runtime role can append/read audit logs but cannot UPDATE/DELETE/TRUNCATE them,
//   * omega_app_dev can read the global catalogs but cannot write them or read
//     the migration ledger, while the auth throttle stays writable.
//
// Usage:
//   DATABASE_URL=postgres://postgres@127.0.0.1:5432/omega_pending_migrations_test \
//     node scripts/rehearse-pending-migrations.mjs
//
// Safety: loopback only, database name must end in "_test", and only that
// database's public schema is rebuilt. No shared or production target is possible.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { compareMigrationNames } from './migration-order.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../src/migrations');
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required (disposable local *_test database).');
}

const url = new URL(connectionString);
const host = url.hostname.toLowerCase().replace('[', '').replace(']', '');
const database = decodeURIComponent(url.pathname.slice(1));
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error('Refusing to rehearse against a non-loopback host.');
}
if (!database.endsWith('_test')) {
  throw new Error('Refusing to rehearse against a database whose name does not end in "_test".');
}

const PENDING = [
  '202611180001_manufacturing_quality_rebatch.sql',
  '202611180002_inventory_batch_traceability.sql',
  '202611190001_user_display_preferences.sql',
  '202611190002_user_display_preferences_rls.sql',
  '202611210001_control_plane_least_privilege.sql',
  '202611210002_audit_logs_append_only.sql',
];

const APP_ROLE = 'omega_app_dev';
const NEW_TABLES = [
  'manufacturing_quality_events',
  'manufacturing_rebatch_lots',
  'manufacturing_rebatch_consumptions',
  'manufacturing_rebatch_reservations',
  'inventory_batches',
  'inventory_stock_movement_allocations',
  'sales_order_reservation_batch_allocations',
  'user_display_preferences',
];

const ids = {
  companyA: 'aa000000-0000-4000-8000-00000000000a',
  companyB: 'bb000000-0000-4000-8000-00000000000b',
  userA: 'a0000000-0000-4000-8000-0000000000a1',
  userA2: 'a0000000-0000-4000-8000-0000000000a2',
  userB: 'b0000000-0000-4000-8000-0000000000b1',
  warehouseA: 'a0000000-0000-4000-8000-0000000000w1'.replace('w', '0'),
  warehouseB: 'b0000000-0000-4000-8000-0000000000b2',
  productA1: 'a0000000-0000-4000-8000-0000000000c1',
  productA2: 'a0000000-0000-4000-8000-0000000000c2',
  productA3: 'a0000000-0000-4000-8000-0000000000c3',
  productB1: 'b0000000-0000-4000-8000-0000000000c3',
  stockA1: 'a0000000-0000-4000-8000-0000000000d1',
  stockA2: 'a0000000-0000-4000-8000-0000000000d2',
  stockA3: 'a0000000-0000-4000-8000-0000000000d3',
  stockB1: 'b0000000-0000-4000-8000-0000000000d4',
  bomA: 'a0000000-0000-4000-8000-0000000000e1',
  orderA: 'a0000000-0000-4000-8000-0000000000f1',
};

const client = new pg.Client({ connectionString });
const results = [];
let createdRole = false;

function record(ok, name, detail = '') {
  results.push({ ok, name, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    record(true, name, typeof detail === 'string' ? detail : '');
  } catch (error) {
    record(false, name, String(error?.message ?? error));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function count(sql, params = []) {
  const r = await client.query(sql, params);
  return Number(r.rows[0].count);
}

async function expectPgError(sql, params, code) {
  await client.query('BEGIN');
  let failure;
  try {
    await client.query(sql, params);
  } catch (error) {
    failure = error;
  }
  await client.query('ROLLBACK');
  if (!failure) {
    throw new Error(`statement unexpectedly succeeded: ${sql.slice(0, 80)}`);
  }
  if (failure.code !== code) {
    throw new Error(`expected PostgreSQL error ${code}, got ${failure.code ?? failure.message}`);
  }
  return failure.code;
}

/** Run a callback as the restricted runtime role inside a rolled-back transaction. */
async function asAppRole(companyId, userId, fn) {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE "${APP_ROLE}"`);
    if (companyId !== null) {
      await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);
    }
    if (userId !== null) {
      await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    }
    return await fn();
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
  }
}

async function applyBaseline(files) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS omega_schema_migrations (
      filename TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  for (const filename of files) {
    const sql = await readFile(path.join(migrationsDir, filename), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO omega_schema_migrations(filename, checksum) VALUES($1, $2)', [
        filename,
        checksum,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`baseline migration ${filename} failed: ${error.message}`);
    }
  }
}

function runMigrator() {
  return execFileSync(process.execPath, [path.resolve(here, 'migrate.mjs')], {
    env: { ...process.env, DATABASE_URL: connectionString },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

async function seedBaselineFixtures() {
  await client.query(
    `INSERT INTO companies(id, name, currency, timezone, is_active) VALUES
       ($1, 'Pending Rehearsal A', 'KES', 'Africa/Nairobi', true),
       ($2, 'Pending Rehearsal B', 'KES', 'Africa/Nairobi', true)`,
    [ids.companyA, ids.companyB],
  );
  await client.query(
    `INSERT INTO users(id, email, password_hash, full_name) VALUES
       ($1, 'pending-a@example.test', 'hash', 'User A'),
       ($2, 'pending-a2@example.test', 'hash', 'User A2'),
       ($3, 'pending-b@example.test', 'hash', 'User B')`,
    [ids.userA, ids.userA2, ids.userB],
  );
  await client.query(
    `INSERT INTO company_memberships(user_id, company_id, role, is_active) VALUES
       ($1, $2, 'owner', true),
       ($3, $2, 'staff', true),
       ($4, $5, 'owner', true)`,
    [ids.userA, ids.companyA, ids.userA2, ids.userB, ids.companyB],
  );
  await client.query(
    `INSERT INTO warehouses(id, company_id, code, name) VALUES
       ($1, $2, 'MAIN', 'A Main'), ($3, $4, 'MAIN', 'B Main')`,
    [ids.warehouseA, ids.companyA, ids.warehouseB, ids.companyB],
  );
  await client.query(
    `INSERT INTO products(id, company_id, sku, name, unit, cost_price) VALUES
       ($1, $2, 'SKU-A1', 'Product A1', 'pcs', 12.5),
       ($3, $2, 'SKU-A2', 'Product A2', 'pcs', 3.0),
       ($4, $2, 'SKU-A3', 'Product A3', 'pcs', 7.0),
       ($5, $6, 'SKU-B1', 'Product B1', 'pcs', 5.0)`,
    [ids.productA1, ids.companyA, ids.productA2, ids.productA3, ids.productB1, ids.companyB],
  );
  // One positive level with a reservation, one zero level, one fully reserved
  // level (which must become a depleted snapshot), and one foreign-company level.
  await client.query(
    `INSERT INTO inventory_stock_levels(id, company_id, warehouse_id, product_id, quantity, reserved_quantity, average_unit_cost) VALUES
       ($1, $2, $3, $4, 10, 3, 12.5),
       ($5, $2, $3, $6, 0, 0, 0),
       ($7, $2, $3, $8, 4, 4, 7),
       ($9, $10, $11, $12, 6, 0, 5)`,
    [
      ids.stockA1,
      ids.companyA,
      ids.warehouseA,
      ids.productA1,
      ids.stockA2,
      ids.productA2,
      ids.stockA3,
      ids.productA3,
      ids.stockB1,
      ids.companyB,
      ids.warehouseB,
      ids.productB1,
    ],
  );
  await client.query(
    `INSERT INTO manufacturing_boms(id, company_id, code, name, product_id) VALUES ($1, $2, 'BOM-A1', 'Rehearsal BOM', $3)`,
    [ids.bomA, ids.companyA, ids.productA1],
  );
  await client.query(
    `INSERT INTO manufacturing_production_orders(id, company_id, order_number, bom_id, warehouse_id, planned_quantity) VALUES ($1, $2, 'PO-A1', $3, $4, 5)`,
    [ids.orderA, ids.companyA, ids.bomA, ids.warehouseA],
  );
}

async function main() {
  await client.connect();

  // ---------------------------------------------------------------- baseline
  await client.query('DROP SCHEMA public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const allFiles = (await readdir(migrationsDir))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
    .sort(compareMigrationNames);
  const firstPendingIndex = allFiles.indexOf(PENDING[0]);
  assert(firstPendingIndex > 0, `could not locate ${PENDING[0]} in the ordered migration set`);
  const pendingSet = allFiles.slice(firstPendingIndex);
  assert(
    PENDING.every(name => pendingSet.includes(name)),
    'the five pending migrations are not contiguous at the end of the ordered set',
  );
  record(
    true,
    'pending set resolved from the ordered migration tree',
    `${pendingSet.length} file(s): ${pendingSet.join(', ')}`,
  );

  await applyBaseline(allFiles.slice(0, firstPendingIndex));
  record(
    true,
    'baseline schema installed (development schema before the pending migrations)',
    `${firstPendingIndex} migrations applied directly`,
  );

  await check('baseline schema does not yet contain any pending object', async () => {
    const r = await client.query(
      `SELECT count(*)::int AS present FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
      [NEW_TABLES],
    );
    assert(r.rows[0].present === 0, `expected none, found ${r.rows[0].present} pending tables`);
    return '8 new tables absent before the pending set';
  });

  await seedBaselineFixtures();
  record(true, 'baseline fixtures seeded', '2 companies, 3 users, 4 stock levels, 1 production order');

  // A runtime role that already held broad access, exactly like an unhardened
  // deployment. The pending migrations' GRANT/REVOKE statements bind only if it exists.
  const roleExists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [APP_ROLE]);
  if (!roleExists.rowCount) {
    await client.query(`CREATE ROLE "${APP_ROLE}" NOLOGIN NOBYPASSRLS`);
    createdRole = true;
  }
  await client.query(`GRANT "${APP_ROLE}" TO CURRENT_USER`);
  await client.query(`GRANT USAGE ON SCHEMA public TO "${APP_ROLE}"`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${APP_ROLE}"`);
  record(true, 'restricted runtime role prepared', `${APP_ROLE} (NOBYPASSRLS), pre-granted broad access`);

  // ------------------------------------------------- apply the pending files
  const firstOutput = runMigrator();
  const appliedOrder = [...firstOutput.matchAll(/→ Applying (.+)/g)].map(match => match[1]);
  record(
    appliedOrder.length > 0,
    'migration runner applied the pending set in order',
    appliedOrder.join(' → '),
  );
  assert(
    JSON.stringify(appliedOrder) === JSON.stringify(pendingSet),
    `runner order ${JSON.stringify(appliedOrder)} != expected ${JSON.stringify(pendingSet)}`,
  );

  // ------------------------------------------------------- rebatch index fix
  await check('rebatch availability index matches the application status values', async () => {
    const r = await client.query(
      `SELECT pg_get_indexdef('public.manufacturing_rebatch_lots_available_idx'::regclass) AS def`,
    );
    const def = r.rows[0].def;
    const lowered = def.toLowerCase();
    assert(lowered.includes("'available'") && lowered.includes("'partially_consumed'"), `unexpected predicate: ${def}`);
    assert(!lowered.includes('released'), `predicate still references the invalid status: ${def}`);
    return def;
  });

  await check("rebatch status domain rejects the old 'released' value", async () => {
    const event = await client.query(
      `INSERT INTO manufacturing_quality_events(company_id, product_id, warehouse_id, event_number, event_type, affected_quantity, reason, status)
       VALUES ($1, $2, $3, 'QE-INDEX-1', 'spoiled', 1, 'rehearsal', 'approved') RETURNING id`,
      [ids.companyA, ids.productA1, ids.warehouseA],
    );
    const code = await expectPgError(
      `INSERT INTO manufacturing_rebatch_lots(company_id, quality_event_id, product_id, warehouse_id, lot_number, quantity_received, quantity_remaining, unit_cost, status, approved_by)
       VALUES ($1, $2, $3, $4, 'LOT-RELEASED', 1, 1, 1, 'released', $5)`,
      [ids.companyA, event.rows[0].id, ids.productA1, ids.warehouseA, ids.userA],
      '23514',
    );
    return `status check raised ${code}`;
  });

  await check('index is used for the application availability query', async () => {
    const event = await client.query('SELECT id FROM manufacturing_quality_events WHERE event_number = $1', ['QE-INDEX-1']);
    await client.query(
      `INSERT INTO manufacturing_rebatch_lots(company_id, quality_event_id, product_id, warehouse_id, lot_number, quantity_received, quantity_remaining, unit_cost, status, approved_by) VALUES
         ($1, $2, $3, $4, 'LOT-AVAIL-1', 5, 5, 2, 'available', $5)`,
      [ids.companyA, event.rows[0].id, ids.productA1, ids.warehouseA, ids.userA],
    );
    const second = await client.query(
      `INSERT INTO manufacturing_quality_events(company_id, product_id, warehouse_id, event_number, event_type, affected_quantity, reason, status)
       VALUES ($1, $2, $3, 'QE-INDEX-2', 'spoiled', 1, 'rehearsal', 'approved') RETURNING id`,
      [ids.companyA, ids.productA1, ids.warehouseA],
    );
    await client.query(
      `INSERT INTO manufacturing_rebatch_lots(company_id, quality_event_id, product_id, warehouse_id, lot_number, quantity_received, quantity_remaining, unit_cost, status, approved_by) VALUES
         ($1, $2, $3, $4, 'LOT-PARTIAL-1', 4, 1, 2, 'partially_consumed', $5)`,
      [ids.companyA, second.rows[0].id, ids.productA2, ids.warehouseA, ids.userA],
    );
    const third = await client.query(
      `INSERT INTO manufacturing_quality_events(company_id, product_id, warehouse_id, event_number, event_type, affected_quantity, reason, status)
       VALUES ($1, $2, $3, 'QE-INDEX-3', 'spoiled', 1, 'rehearsal', 'approved') RETURNING id`,
      [ids.companyA, ids.productA3, ids.warehouseA],
    );
    await client.query(
      `INSERT INTO manufacturing_rebatch_lots(company_id, quality_event_id, product_id, warehouse_id, lot_number, quantity_received, quantity_remaining, unit_cost, status, approved_by) VALUES
         ($1, $2, $3, $4, 'LOT-CONSUMED-1', 4, 0, 2, 'consumed', $5)`,
      [ids.companyA, third.rows[0].id, ids.productA3, ids.warehouseA, ids.userA],
    );
    await client.query('BEGIN');
    await client.query('SET LOCAL enable_seqscan = off');
    let plan;
    try {
      plan = await client.query(
        `EXPLAIN SELECT id FROM manufacturing_rebatch_lots
         WHERE company_id = $1 AND warehouse_id = $2 AND product_id = $3
           AND status IN ('available','partially_consumed')`,
        [ids.companyA, ids.warehouseA, ids.productA1],
      );
    } finally {
      await client.query('ROLLBACK');
    }
    const planText = plan.rows.map(row => row['QUERY PLAN']).join('\n');
    assert(/manufacturing_rebatch_lots_available_idx/.test(planText), `index not chosen:\n${planText}`);
    return 'planner selects manufacturing_rebatch_lots_available_idx';
  });

  // ------------------------------------------------------ inventory backfill
  await check('inventory backfill creates one released legacy snapshot per positive level', async () => {
    const rows = await client.query(
      `SELECT s.id AS stock_id, b.batch_code, b.quantity_on_hand, b.reserved_quantity, b.unit_cost,
              b.source_type, b.source_reference, b.quality_status, b.status
       FROM inventory_stock_levels s
       JOIN inventory_batches b ON b.company_id = s.company_id AND b.source_reference = s.id::text
       WHERE s.quantity > 0
       ORDER BY s.id`,
    );
    assert(rows.rowCount === 3, `expected 3 snapshots, found ${rows.rowCount}`);
    for (const row of rows.rows) {
      assert(row.source_type === 'legacy_snapshot', `unexpected source_type ${row.source_type}`);
      assert(row.quality_status === 'released', `unexpected quality_status ${row.quality_status}`);
      assert(
        row.batch_code === `LEGACY-${row.stock_id.replaceAll('-', '').toUpperCase()}`,
        `unexpected batch code ${row.batch_code}`,
      );
    }
    return '3 positive stock levels → 3 legacy_snapshot lots';
  });

  await check('backfill copies quantity, reservation and cost exactly', async () => {
    const r = await client.query(
      `SELECT bool_and(
                b.quantity_on_hand = s.quantity
            AND b.received_quantity = s.quantity
            AND b.reserved_quantity = s.reserved_quantity
            AND b.unit_cost = s.average_unit_cost
              ) AS identical
       FROM inventory_stock_levels s
       JOIN inventory_batches b ON b.company_id = s.company_id AND b.source_reference = s.id::text
       WHERE s.quantity > 0`,
    );
    assert(r.rows[0].identical === true, 'snapshot columns differ from the stock level');
    return 'quantity, reserved_quantity and unit_cost match inventory_stock_levels';
  });

  await check('zero-quantity levels are not snapshotted and fully reserved levels are depleted', async () => {
    const zero = await count(
      `SELECT count(*) FROM inventory_batches WHERE source_reference = $1`,
      [ids.stockA2],
    );
    assert(zero === 0, 'a zero-quantity stock level produced a snapshot');
    const depleted = await client.query(
      'SELECT status FROM inventory_batches WHERE source_reference = $1',
      [ids.stockA3],
    );
    assert(depleted.rows[0]?.status === 'depleted', `fully reserved level status = ${depleted.rows[0]?.status}`);
    const available = await client.query(
      'SELECT status FROM inventory_batches WHERE source_reference = $1',
      [ids.stockA1],
    );
    assert(available.rows[0]?.status === 'available', `partially reserved level status = ${available.rows[0]?.status}`);
    return 'zero quantity skipped; 4/4 reserved → depleted; 10/3 reserved → available';
  });

  await check('backfill does not move stock and creates no movements', async () => {
    const movements = await count('SELECT count(*) FROM inventory_stock_movements');
    assert(movements === 0, `expected no movements, found ${movements}`);
    const totals = await client.query(
      `SELECT sum(quantity)::text AS quantity, sum(reserved_quantity)::text AS reserved FROM inventory_stock_levels`,
    );
    assert(totals.rows[0].quantity === '20.0000', `stock total changed: ${totals.rows[0].quantity}`);
    assert(totals.rows[0].reserved === '7.0000', `reserved total changed: ${totals.rows[0].reserved}`);
    return 'aggregate 20.0000 / reserved 7.0000 unchanged, 0 movements';
  });

  await check('every batch total equals its source stock level', async () => {
    const mismatch = await count(
      `SELECT count(*) FROM inventory_stock_levels s
       LEFT JOIN inventory_batches b ON b.company_id = s.company_id AND b.source_reference = s.id::text
       WHERE s.quantity > 0
         AND (b.id IS NULL OR b.quantity_on_hand <> s.quantity OR b.reserved_quantity <> s.reserved_quantity)`,
    );
    assert(mismatch === 0, `${mismatch} stock level(s) without a matching snapshot`);
    return 'sum(batch quantity_on_hand) = aggregate quantity for every level';
  });

  // ------------------------------------------------- idempotent re-application
  await check('re-running the migration set is idempotent', async () => {
    const secondOutput = runMigrator();
    assert(/already applied/.test(secondOutput), 'runner did not report the pending files as applied');
    const batches = await count('SELECT count(*) FROM inventory_batches');
    assert(batches === 3, `backfill duplicated rows: ${batches} batches`);
    const index = await client.query(
      `SELECT pg_get_indexdef('public.manufacturing_rebatch_lots_available_idx'::regclass) AS def`,
    );
    assert(
      index.rows[0].def.toLowerCase().includes("'partially_consumed'"),
      'index predicate regressed on re-application',
    );
    return 'no duplicate snapshots; index and policies unchanged';
  });

  // ------------------------------------------------------ uniqueness checks
  await check('batch codes are unique per company but reusable across companies', async () => {
    await client.query(
      `INSERT INTO inventory_batches(company_id, product_id, warehouse_id, batch_code, received_quantity, quantity_on_hand, unit_cost)
       VALUES ($1, $2, $3, 'DUP-1', 1, 1, 1),
              ($4, $5, $6, 'DUP-1', 1, 1, 1)`,
      [ids.companyA, ids.productA1, ids.warehouseA, ids.companyB, ids.productB1, ids.warehouseB],
    );
    const code = await expectPgError(
      `INSERT INTO inventory_batches(company_id, product_id, warehouse_id, batch_code, received_quantity, quantity_on_hand, unit_cost)
       VALUES ($1, $2, $3, 'DUP-1', 1, 1, 1)`,
      [ids.companyA, ids.productA1, ids.warehouseA],
      '23505',
    );
    return `same company rejected with ${code}; other company accepted`;
  });

  await check('oversold and negative batch quantities are rejected', async () => {
    const reserved = await expectPgError(
      `INSERT INTO inventory_batches(company_id, product_id, warehouse_id, batch_code, received_quantity, quantity_on_hand, reserved_quantity, unit_cost)
       VALUES ($1, $2, $3, 'BAD-RES', 5, 2, 3, 1)`,
      [ids.companyA, ids.productA1, ids.warehouseA],
      '23514',
    );
    const negative = await expectPgError(
      `INSERT INTO inventory_batches(company_id, product_id, warehouse_id, batch_code, received_quantity, quantity_on_hand, unit_cost)
       VALUES ($1, $2, $3, 'BAD-QTY', -1, 0, 1)`,
      [ids.companyA, ids.productA1, ids.warehouseA],
      '23514',
    );
    return `reserved > on hand rejected (${reserved}); negative receipt rejected (${negative})`;
  });

  await check('rebatch lot numbers and quality events are unique per company', async () => {
    const event = await client.query("SELECT id FROM manufacturing_quality_events WHERE event_number = 'QE-INDEX-1'");
    const duplicateLot = await expectPgError(
      `INSERT INTO manufacturing_rebatch_lots(company_id, quality_event_id, product_id, warehouse_id, lot_number, quantity_received, quantity_remaining, unit_cost, approved_by)
       VALUES ($1, $2, $3, $4, 'LOT-AVAIL-1', 1, 1, 1, $5)`,
      [ids.companyA, event.rows[0].id, ids.productA2, ids.warehouseA, ids.userA],
      '23505',
    );
    const duplicateEvent = await expectPgError(
      `INSERT INTO manufacturing_rebatch_lots(company_id, quality_event_id, product_id, warehouse_id, lot_number, quantity_received, quantity_remaining, unit_cost, approved_by)
       VALUES ($1, $2, $3, $4, 'LOT-OTHER', 1, 1, 1, $5)`,
      [ids.companyA, event.rows[0].id, ids.productA3, ids.warehouseA, ids.userA],
      '23505',
    );
    return `duplicate lot ${duplicateLot}; second lot for one event ${duplicateEvent}`;
  });

  await check('rebatch recoverable + disposal cannot exceed the affected quantity', async () => {
    const code = await expectPgError(
      `INSERT INTO manufacturing_quality_events(company_id, product_id, warehouse_id, event_number, event_type, affected_quantity, recoverable_quantity, disposal_quantity, reason)
       VALUES ($1, $2, $3, 'QE-OVER', 'spoiled', 5, 4, 4, 'rehearsal')`,
      [ids.companyA, ids.productA1, ids.warehouseA],
      '23514',
    );
    return `quantity split check raised ${code}`;
  });

  await check('movement and reservation allocations reject duplicates', async () => {
    const movement = await client.query(
      `INSERT INTO inventory_stock_movements(company_id, product_id, warehouse_id, movement_type, quantity, unit_cost)
       VALUES ($1, $2, $3, 'receipt', 2, 1) RETURNING id`,
      [ids.companyA, ids.productA1, ids.warehouseA],
    );
    const batch = await client.query(
      'SELECT id FROM inventory_batches WHERE source_reference = $1',
      [ids.stockA1],
    );
    await client.query(
      `INSERT INTO inventory_stock_movement_allocations(company_id, movement_id, batch_id, product_id, warehouse_id, quantity, unit_cost)
       VALUES ($1, $2, $3, $4, $5, 2, 1)`,
      [ids.companyA, movement.rows[0].id, batch.rows[0].id, ids.productA1, ids.warehouseA],
    );
    const duplicate = await expectPgError(
      `INSERT INTO inventory_stock_movement_allocations(company_id, movement_id, batch_id, product_id, warehouse_id, quantity, unit_cost)
       VALUES ($1, $2, $3, $4, $5, 1, 1)`,
      [ids.companyA, movement.rows[0].id, batch.rows[0].id, ids.productA1, ids.warehouseA],
      '23505',
    );
    return `duplicate movement/batch allocation rejected (${duplicate})`;
  });

  await check('display preferences require a real membership and reject duplicates', async () => {
    await client.query(
      `INSERT INTO user_display_preferences(user_id, company_id, date_format) VALUES ($1, $2, 'YYYY-MM-DD')`,
      [ids.userA, ids.companyA],
    );
    const duplicate = await expectPgError(
      `INSERT INTO user_display_preferences(user_id, company_id) VALUES ($1, $2)`,
      [ids.userA, ids.companyA],
      '23505',
    );
    const nonMember = await expectPgError(
      `INSERT INTO user_display_preferences(user_id, company_id) VALUES ($1, $2)`,
      [ids.userA, ids.companyB],
      '23503',
    );
    const badFormat = await expectPgError(
      `INSERT INTO user_display_preferences(user_id, company_id, date_format) VALUES ($1, $2, 'not-a-format')`,
      [ids.userA2, ids.companyA],
      '23514',
    );
    return `duplicate ${duplicate}; non-member ${nonMember}; invalid format ${badFormat}`;
  });

  // ------------------------------------------------------------------- RLS
  await check('RLS is enabled with a policy on every new table', async () => {
    const tables = await client.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) AS policies
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
       ORDER BY c.relname`,
      [NEW_TABLES],
    );
    assert(tables.rowCount === NEW_TABLES.length, `expected ${NEW_TABLES.length} tables, found ${tables.rowCount}`);
    for (const row of tables.rows) {
      assert(row.relrowsecurity === true, `${row.relname}: RLS not enabled`);
      assert(row.policies === 1, `${row.relname}: expected exactly 1 policy, found ${row.policies}`);
    }
    return `${NEW_TABLES.length} tables, ${NEW_TABLES.length} policies, 0 without RLS`;
  });

  await check('runtime role cannot bypass RLS', async () => {
    const r = await client.query('SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1', [APP_ROLE]);
    assert(r.rows[0].rolbypassrls === false, 'role bypasses RLS');
    assert(r.rows[0].rolsuper === false, 'role is superuser');
    return 'rolbypassrls=false, rolsuper=false';
  });

  await check('a company sees only its own rebatch lots', async () => {
    const visible = await asAppRole(ids.companyA, ids.userA, async () => {
      const r = await client.query('SELECT company_id FROM manufacturing_rebatch_lots');
      return r.rows.map(row => row.company_id);
    });
    assert(visible.length === 3, `expected 3 visible lots, found ${visible.length}`);
    assert(visible.every(id => id === ids.companyA), 'foreign company rows leaked');
    return '3 own lots visible, 0 foreign';
  });

  await check('a member of one company cannot read another company even with a spoofed context', async () => {
    const visible = await asAppRole(ids.companyB, ids.userA, async () => {
      const r = await client.query('SELECT id FROM manufacturing_rebatch_lots');
      return r.rowCount;
    });
    assert(visible === 0, `tenant spoofing returned ${visible} rows`);
    return 'app.company_id=B with user A membership → 0 rows';
  });

  await check('missing tenant context hides every row', async () => {
    const visible = await asAppRole(null, null, async () => {
      const r = await client.query('SELECT id FROM inventory_batches');
      return r.rowCount;
    });
    assert(visible === 0, `no-context read returned ${visible} rows`);
    return '0 rows without app.company_id/app.user_id';
  });

  await check('cross-company inserts are refused by the WITH CHECK clause', async () => {
    const code = await asAppRole(ids.companyA, ids.userA, async () => {
      await client.query('SAVEPOINT rls_insert');
      try {
        await client.query(
          `INSERT INTO inventory_batches(company_id, product_id, warehouse_id, batch_code, received_quantity, quantity_on_hand, unit_cost)
           VALUES ($1, $2, $3, 'FORGED', 1, 1, 1)`,
          [ids.companyB, ids.productB1, ids.warehouseB],
        );
        return 'succeeded';
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT rls_insert');
        return String(error.code);
      }
    });
    assert(code === '42501', `expected 42501, got ${code}`);
    return 'foreign company INSERT rejected with 42501';
  });

  await check('display preferences are isolated by user as well as company', async () => {
    await client.query(
      `INSERT INTO user_display_preferences(user_id, company_id) VALUES ($1, $2)`,
      [ids.userA2, ids.companyA],
    );
    const visible = await asAppRole(ids.companyA, ids.userA, async () => {
      const r = await client.query('SELECT user_id FROM user_display_preferences');
      return r.rows.map(row => row.user_id);
    });
    assert(visible.length === 1 && visible[0] === ids.userA, `user A saw ${visible.length} preference row(s)`);

    const forged = await asAppRole(ids.companyA, ids.userA, async () => {
      await client.query('SAVEPOINT prefs');
      try {
        await client.query(
          `UPDATE user_display_preferences SET date_format = 'MM/DD/YYYY' WHERE user_id = $1`,
          [ids.userA2],
        );
        const r = await client.query('SELECT count(*)::int AS changed FROM user_display_preferences WHERE user_id = $1', [ids.userA2]);
        await client.query('ROLLBACK TO SAVEPOINT prefs');
        return Number(r.rows[0].changed);
      } catch (error) {
        return String(error.code);
      }
    });
    assert(forged === 0, `another user's preference was reachable: ${forged}`);
    return "only the caller's own row is visible and writable";
  });

  // ------------------------------------------------- control-plane grants
  await check('runtime role can still read the global catalogs', async () => {
    const counts = await asAppRole(ids.companyA, ids.userA, async () => {
      const permissions = await client.query('SELECT permission FROM public.permissions LIMIT 1');
      const mapping = await client.query('SELECT role, permission_id FROM public.role_permissions LIMIT 1');
      const plans = await client.query('SELECT code FROM public.subscription_plans LIMIT 1');
      return [permissions.rowCount, mapping.rowCount, plans.rowCount];
    });
    assert(counts.every(n => n === 1), `catalog reads returned ${counts.join(',')}`);
    return 'permissions, role_permissions and subscription_plans readable';
  });

  await check('runtime role cannot write permissions, role_permissions or subscription_plans', async () => {
    const codes = await asAppRole(ids.companyA, ids.userA, async () => {
      const out = [];
      for (const statement of [
        `INSERT INTO public.permissions(id, permission) VALUES (gen_random_uuid(), 'forged:permission')`,
        `UPDATE public.permissions SET permission = 'tampered' WHERE permission IS NOT NULL`,
        `DELETE FROM public.role_permissions WHERE role = 'staff'`,
        `INSERT INTO public.role_permissions(role, permission_id) SELECT 'staff', id FROM public.permissions LIMIT 1`,
        `UPDATE public.subscription_plans SET name = 'tampered'`,
        `DELETE FROM public.subscription_plans`,
        `TRUNCATE public.subscription_plans`,
      ]) {
        await client.query('SAVEPOINT cp');
        try {
          await client.query(statement);
          out.push(`succeeded:${statement.slice(0, 24)}`);
        } catch (error) {
          out.push(String(error.code));
        }
        await client.query('ROLLBACK TO SAVEPOINT cp');
        await client.query('RELEASE SAVEPOINT cp');
      }
      return out;
    });
    assert(codes.every(code => code === '42501'), `expected only 42501, got ${codes.join(', ')}`);
    return `7 write statements rejected with 42501`;
  });

  await check('runtime role can read and append audit logs but cannot rewrite them', async () => {
    const outcome = await asAppRole(ids.companyA, ids.userA, async () => {
      const read = await client.query('SELECT id FROM public.audit_logs LIMIT 1');
      const insert = await client.query(
        `INSERT INTO public.audit_logs(company_id, user_id, action, entity_type, entity_id)
         VALUES ($1, $2, 'rehearsal.audit.append', 'rehearsal', gen_random_uuid()) RETURNING id`,
        [ids.companyA, ids.userA],
      );
      const codes = [];
      for (const statement of [
        `UPDATE public.audit_logs SET action = 'tampered' WHERE id = '${insert.rows[0].id}'`,
        `DELETE FROM public.audit_logs WHERE id = '${insert.rows[0].id}'`,
        'TRUNCATE public.audit_logs',
      ]) {
        await client.query('SAVEPOINT audit_acl');
        try { await client.query(statement); codes.push('succeeded'); }
        catch (error) { codes.push(String(error.code)); }
        await client.query('ROLLBACK TO SAVEPOINT audit_acl');
        await client.query('RELEASE SAVEPOINT audit_acl');
      }
      return { read: read.rowCount, inserted: insert.rowCount, codes };
    });
    assert(outcome.inserted === 1, 'runtime role could not append an audit event');
    assert(outcome.codes.every(code => code === '42501'), `expected UPDATE/DELETE/TRUNCATE denied, got ${outcome.codes.join(',')}`);
    return 'SELECT and INSERT permitted; UPDATE, DELETE and TRUNCATE rejected with 42501';
  });

  await check('runtime role cannot read the migration ledger', async () => {
    const code = await asAppRole(ids.companyA, ids.userA, async () => {
      try {
        await client.query('SELECT filename FROM public.omega_schema_migrations LIMIT 1');
        return 'succeeded';
      } catch (error) {
        return String(error.code);
      }
    });
    assert(code === '42501', `expected 42501, got ${code}`);
    return 'SELECT on omega_schema_migrations rejected with 42501';
  });

  await check('auth throttle remains writable, because login depends on it', async () => {
    const value = await asAppRole(ids.companyA, ids.userA, async () => {
      const keyHash = createHash('sha256').update('pending-rehearsal').digest('hex');
      const write = await client.query(
        `INSERT INTO public.auth_rate_limits(key_hash, window_started_at, request_count)
         VALUES ($1, date_trunc('minute', NOW()), 1)
         ON CONFLICT (key_hash, window_started_at) DO UPDATE SET request_count = public.auth_rate_limits.request_count + 1
         RETURNING request_count`,
        [keyHash],
      );
      return Number(write.rows[0].request_count);
    });
    assert(value >= 1, `throttle write returned ${value}`);
    return 'INSERT/UPDATE on auth_rate_limits still permitted';
  });

  // --------------------------------------------------------------- summary
  const failed = results.filter(r => !r.ok);
  console.log(`\nRehearsal complete on ${database}: ${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    for (const f of failed) console.error(`FAILED: ${f.name} — ${f.detail}`);
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(`Rehearsal aborted: ${error?.message ?? error}`);
  process.exitCode = 1;
} finally {
  try {
    if (createdRole) {
      await client.query(`REVOKE "${APP_ROLE}" FROM CURRENT_USER`).catch(() => undefined);
      await client.query(`DROP OWNED BY "${APP_ROLE}"`).catch(() => undefined);
      await client.query(`DROP ROLE IF EXISTS "${APP_ROLE}"`).catch(() => undefined);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}
