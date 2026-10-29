import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
const explicitlyIsolated = process.env.ALLOW_ISOLATED_MIGRATION_FIXTURE === 'true';
if (!connectionString || !explicitlyIsolated) {
  throw new Error('Refusing migration fixture: DATABASE_URL and ALLOW_ISOLATED_MIGRATION_FIXTURE=true are required.');
}
const parsed = new URL(connectionString);
if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) || parsed.pathname !== '/omega_migration_test') {
  throw new Error('Refusing migration fixture: this test is restricted to the disposable local omega_migration_test database.');
}

const client = new pg.Client({ connectionString });
const schema = 'weighted_cost_migration_test';
const migration = await readFile(new URL('../src/migrations/032_inventory_weighted_average_cost.sql', import.meta.url), 'utf8');
await client.connect();
try {
  await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}; SET search_path TO ${schema}, public;`);
  await client.query(`
    CREATE TABLE inventory_stock_levels (
      company_id uuid NOT NULL,
      warehouse_id uuid NOT NULL,
      product_id uuid NOT NULL,
      quantity numeric(16,4) NOT NULL,
      PRIMARY KEY (company_id, warehouse_id, product_id)
    );
    CREATE TABLE inventory_stock_movements (
      company_id uuid NOT NULL,
      warehouse_id uuid NOT NULL,
      product_id uuid NOT NULL,
      movement_type text NOT NULL,
      quantity numeric(16,4) NOT NULL,
      unit_cost numeric(16,4) NOT NULL
    );
  `);
  const company = '11111111-1111-4111-8111-111111111111';
  const warehouse = '22222222-2222-4222-8222-222222222222';
  const stocked = '33333333-3333-4333-8333-333333333333';
  const noInbound = '44444444-4444-4444-8444-444444444444';
  await client.query(
    'INSERT INTO inventory_stock_levels(company_id, warehouse_id, product_id, quantity) VALUES ($1,$2,$3,4),($1,$2,$4,3)',
    [company, warehouse, stocked, noInbound],
  );
  await client.query(`
    INSERT INTO inventory_stock_movements(company_id, warehouse_id, product_id, movement_type, quantity, unit_cost)
    VALUES
      ($1,$2,$3,'receipt',2,100),
      ($1,$2,$3,'opening_balance',2,120),
      ($1,$2,$4,'issue',3,90),
      ($1,$2,$4,'receipt',-1,90)
  `, [company, warehouse, stocked, noInbound]);

  await client.query(migration);
  let result = await client.query(
    'SELECT product_id, quantity, average_unit_cost FROM inventory_stock_levels ORDER BY product_id',
  );
  const first = result.rows.find((row) => row.product_id === stocked);
  const second = result.rows.find((row) => row.product_id === noInbound);
  assert.equal(Number(first?.average_unit_cost), 110, 'positive inbound movement history should seed weighted average cost');
  assert.equal(Number(second?.average_unit_cost), 0, 'issue and non-positive inbound movements must not seed a cost');

  await client.query('UPDATE inventory_stock_levels SET average_unit_cost=77 WHERE product_id=$1', [stocked]);
  await client.query(migration);
  result = await client.query(
    'SELECT product_id, average_unit_cost FROM inventory_stock_levels ORDER BY product_id',
  );
  const preserved = result.rows.find((row) => row.product_id === stocked);
  assert.equal(Number(preserved?.average_unit_cost), 77, 'rerun must not overwrite an existing non-zero cost');

  const index = await client.query(
    'SELECT 1 FROM pg_indexes WHERE schemaname=$1 AND indexname=$2',
    [schema, 'idx_inventory_stock_company_cost'],
  );
  assert.equal(index.rowCount, 1, 'migration must create the cost lookup index');
  console.log('Weighted-average-cost migration regression passed (isolated schema; no business data).');
} finally {
  await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await client.end();
}
