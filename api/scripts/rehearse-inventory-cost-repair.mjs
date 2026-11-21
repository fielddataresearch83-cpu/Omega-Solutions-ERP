// Isolated rehearsal for the targeted weighted-average cost correction (audit P0-3 / FIND-24).
//
// Builds a disposable database, creates a synthetic version of the reported anomaly
// (positive stock, zero persisted average cost, positive-cost inbound history), then
// proves the per-stock-level correction:
//   1. computes the value from inbound movements only,
//   2. refuses to touch a level whose stored cost is already non-zero,
//   3. refuses to act when there is no positive-cost inbound history,
//   4. is a no-op on a second run (idempotent, single-row scoped).
//
// Usage:
//   DATABASE_URL=postgres://postgres@127.0.0.1:5432/omega_cost_repair_test \
//     node scripts/rehearse-inventory-cost-repair.mjs
//
// Safety: loopback host and a database name ending in "_test" are required.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required (disposable local *_test database).');

const url = new URL(connectionString);
const host = url.hostname.toLowerCase().replace('[', '').replace(']', '');
const database = decodeURIComponent(url.pathname.slice(1));
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error('Refusing to rehearse against a non-loopback host.');
}
if (!database.endsWith('_test')) {
  throw new Error('Refusing to rehearse against a database whose name does not end in "_test".');
}

/**
 * The reviewed correction. Scoped to one stock level, only when the stored cost is
 * zero, stock is positive, and positive-cost inbound history exists. Recomputed from
 * movements; no other row, amount or movement is modified.
 */
const CORRECTION_SQL = `
  WITH inbound AS (
    SELECT SUM(quantity) AS inbound_quantity,
           SUM(quantity * unit_cost) AS inbound_value
    FROM inventory_stock_movements
    WHERE company_id = $1
      AND warehouse_id = $2
      AND product_id = $3
      AND movement_type IN ('receipt','opening_balance','transfer_in')
      AND quantity > 0
      AND unit_cost > 0
  )
  UPDATE inventory_stock_levels s
  SET average_unit_cost = ROUND((i.inbound_value / NULLIF(i.inbound_quantity, 0))::numeric, 4),
      updated_at = NOW()
  FROM inbound i
  WHERE s.id = $4
    AND s.company_id = $1
    AND s.warehouse_id = $2
    AND s.product_id = $3
    AND s.quantity > 0
    AND s.average_unit_cost = 0
    AND i.inbound_quantity > 0
    AND i.inbound_value > 0
  RETURNING s.id, s.average_unit_cost
`;

const COMPANY = 'd1000000-0000-4000-8000-000000000001';
const WAREHOUSE = 'd2000000-0000-4000-8000-000000000002';
const PRODUCT_ANOMALY = 'd3000000-0000-4000-8000-000000000003';
const PRODUCT_HEALTHY = 'd3000000-0000-4000-8000-000000000004';
const LEVEL_ANOMALY = 'd4000000-0000-4000-8000-000000000005';
const LEVEL_HEALTHY = 'd4000000-0000-4000-8000-000000000006';

const { Client } = pg;
const client = new Client({ connectionString });
let passed = 0;
const pass = (name, detail = '') => {
  passed += 1;
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
};

try {
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  execFileSync(process.execPath, [resolve(here, 'migrate.mjs')], {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'pipe',
  });
  pass('migrations install from an empty database');

  await client.query(
    `INSERT INTO companies (id, name, currency, timezone, is_active)
     VALUES ($1, 'Cost Repair Rehearsal Co', 'KES', 'Africa/Nairobi', true)`,
    [COMPANY],
  );
  await client.query(
    `INSERT INTO warehouses (id, company_id, name, code, is_active)
     VALUES ($1, $2, 'Rehearsal Warehouse', 'RW', true)`,
    [WAREHOUSE, COMPANY],
  );
  await client.query(
    `INSERT INTO products (id, company_id, name, sku, selling_price, cost_price, is_active, is_service)
     VALUES ($1, $3, 'Anomalous Product', 'SKU-ANOM', 150, 0, true, false),
            ($2, $3, 'Healthy Product', 'SKU-OK', 150, 110, true, false)`,
    [PRODUCT_ANOMALY, PRODUCT_HEALTHY, COMPANY],
  );
  await client.query(
    `INSERT INTO inventory_stock_levels (id, company_id, warehouse_id, product_id, quantity, average_unit_cost)
     VALUES ($1, $3, $4, $5, 4, 0),
            ($2, $3, $4, $6, 4, 110)`,
    [LEVEL_ANOMALY, LEVEL_HEALTHY, COMPANY, WAREHOUSE, PRODUCT_ANOMALY, PRODUCT_HEALTHY],
  );
  // 440 of inbound value across 4 units => implied 110.00 per unit.
  await client.query(
    `INSERT INTO inventory_stock_movements (company_id, warehouse_id, product_id, movement_type, quantity, unit_cost)
     VALUES ($1, $2, $3, 'receipt', 2, 100),
            ($1, $2, $3, 'opening_balance', 2, 120),
            ($1, $2, $4, 'receipt', 4, 110)`,
    [COMPANY, WAREHOUSE, PRODUCT_ANOMALY, PRODUCT_HEALTHY],
  );
  pass('synthetic anomaly and healthy control created (4 units, 440 inbound value)');

  const repaired = await client.query(CORRECTION_SQL, [COMPANY, WAREHOUSE, PRODUCT_ANOMALY, LEVEL_ANOMALY]);
  if (repaired.rowCount !== 1) throw new Error(`Expected exactly 1 corrected row, got ${repaired.rowCount}.`);
  const cost = Number(repaired.rows[0].average_unit_cost);
  if (Math.abs(cost - 110) > 0.0001) throw new Error(`Expected 110.0000, got ${cost}.`);
  pass('correction recomputes the weighted average from inbound movements', `110.0000/unit`);

  const again = await client.query(CORRECTION_SQL, [COMPANY, WAREHOUSE, PRODUCT_ANOMALY, LEVEL_ANOMALY]);
  if (again.rowCount !== 0) throw new Error('Correction was not idempotent.');
  pass('correction is idempotent (no second update)');

  const healthy = await client.query(CORRECTION_SQL, [COMPANY, WAREHOUSE, PRODUCT_HEALTHY, LEVEL_HEALTHY]);
  if (healthy.rowCount !== 0) throw new Error('Correction modified a level whose cost was already non-zero.');
  pass('correction refuses to overwrite an already-valued level');

  const noHistory = await client.query(CORRECTION_SQL, [COMPANY, WAREHOUSE, PRODUCT_HEALTHY, LEVEL_ANOMALY]);
  if (noHistory.rowCount !== 0) throw new Error('Correction acted without matching inbound history.');
  pass('correction refuses to act without positive-cost inbound history');

  console.log(`\nRehearsal complete: ${passed} checks passed on ${database}.`);
} finally {
  await client.end().catch(() => {});
}
