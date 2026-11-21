// Isolated rehearsal for docs/DEVELOPMENT_SCHEMA_FORWARD_REPAIR.sql (audit P0-1 / P0-3).
//
// Proves, on a throwaway local database only, that the repair bundle:
//   1. installs the migration set from scratch,
//   2. repairs the documented drift (tax snapshot columns, credit-note line links,
//      supplier invoice uniqueness),
//   3. is idempotent when re-applied,
//   4. fails closed instead of silently creating the unique index when duplicate
//      active supplier invoice references already exist.
//
// Usage:
//   DATABASE_URL=postgres://postgres@127.0.0.1:5432/omega_forward_repair_test \
//     node scripts/rehearse-schema-forward-repair.mjs
//
// Safety: refuses non-loopback hosts, requires a database name ending in "_test",
// and rebuilds only the public schema of that disposable database.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = resolve(here, '../../docs/DEVELOPMENT_SCHEMA_FORWARD_REPAIR.sql');
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

const bundle = readFileSync(bundlePath, 'utf8');
const { Client } = pg;
const client = new Client({ connectionString });
const results = [];

function pass(name, detail = '') {
  results.push({ name, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function columnExists(table, column) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column],
  );
  return r.rowCount === 1;
}

async function constraintExists(table, constraint) {
  const r = await client.query(
    `SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
     JOIN pg_namespace n ON n.oid=t.relnamespace
     WHERE n.nspname='public' AND t.relname=$1 AND c.conname=$2`,
    [table, constraint],
  );
  return r.rowCount === 1;
}

async function indexExists(name) {
  const r = await client.query('SELECT to_regclass($1) AS name', [`public.${name}`]);
  return r.rows[0]?.name !== null;
}

async function applyBundle() {
  await client.query(bundle);
}

try {
  await client.connect();

  // 1. Clean disposable schema, then install the real migration set.
  await client.query('DROP SCHEMA public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  execFileSync(process.execPath, [resolve(here, 'migrate.mjs')], {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'pipe',
  });
  pass('migrations install from an empty database');

  // 2. Simulate the documented shared-schema drift.
  for (const [table, constraint] of [
    ['invoice_items', 'invoice_items_tax_treatment_check'],
    ['quotation_items', 'quotation_items_tax_treatment_check'],
    ['supplier_bill_items', 'supplier_bill_items_tax_treatment_check'],
    ['credit_note_items', 'credit_note_items_tax_treatment_check'],
  ]) {
    await client.query(`ALTER TABLE public.${table} DROP CONSTRAINT IF EXISTS ${constraint}`);
  }
  await client.query('DROP INDEX IF EXISTS public.supplier_bills_supplier_invoice_number_unique');
  await client.query('ALTER TABLE public.invoice_items DROP COLUMN IF EXISTS tax_treatment');
  await client.query('ALTER TABLE public.quotation_items DROP COLUMN IF EXISTS tax_treatment');
  await client.query('ALTER TABLE public.supplier_bill_items DROP COLUMN IF EXISTS tax_treatment');
  await client.query('ALTER TABLE public.credit_note_items DROP COLUMN IF EXISTS invoice_item_id');
  await client.query('ALTER TABLE public.credit_note_items DROP COLUMN IF EXISTS tax_treatment');

  if (await columnExists('invoice_items', 'tax_treatment')) throw new Error('Drift simulation failed.');
  pass('drift simulated (tax snapshots, credit-note links and supplier uniqueness absent)');

  // 3. Apply the repair bundle and verify every postcondition.
  await applyBundle();
  const repaired = {
    invoice: await columnExists('invoice_items', 'tax_treatment'),
    quotation: await columnExists('quotation_items', 'tax_treatment'),
    supplierBill: await columnExists('supplier_bill_items', 'tax_treatment'),
    creditLink: await columnExists('credit_note_items', 'invoice_item_id'),
    creditTax: await columnExists('credit_note_items', 'tax_treatment'),
    invoiceCheck: await constraintExists('invoice_items', 'invoice_items_tax_treatment_check'),
    quotationCheck: await constraintExists('quotation_items', 'quotation_items_tax_treatment_check'),
    supplierBillCheck: await constraintExists('supplier_bill_items', 'supplier_bill_items_tax_treatment_check'),
    creditCheck: await constraintExists('credit_note_items', 'credit_note_items_tax_treatment_check'),
    uniqueIndex: await indexExists('supplier_bills_supplier_invoice_number_unique'),
  };
  const missing = Object.entries(repaired).filter(([, ok]) => !ok).map(([name]) => name);
  if (missing.length) throw new Error(`Postconditions missing after repair: ${missing.join(', ')}`);
  pass('repair bundle restores columns, check constraints and the unique index');

  // 4. Re-apply to prove idempotency.
  await applyBundle();
  pass('repair bundle is idempotent on re-application');

  // 5. Fail-closed behaviour with conflicting supplier invoice references.
  const companyId = 'c1000000-0000-4000-8000-000000000001';
  const supplierId = 'c2000000-0000-4000-8000-000000000002';
  await client.query(
    `INSERT INTO public.companies (id, name, currency, timezone, is_active)
     VALUES ($1, 'Forward Repair Rehearsal Co', 'KES', 'Africa/Nairobi', true)`,
    [companyId],
  );
  await client.query(
    `INSERT INTO public.suppliers (id, company_id, name) VALUES ($1, $2, 'Rehearsal Supplier')`,
    [supplierId, companyId],
  );
  // Remove the index first so the conflicting legacy rows can be represented.
  await client.query('DROP INDEX IF EXISTS public.supplier_bills_supplier_invoice_number_unique');
  await client.query(
    `INSERT INTO public.supplier_bills (id, company_id, supplier_id, bill_number, supplier_invoice_number, status)
     VALUES ('c3000000-0000-4000-8000-000000000003', $1, $2, 'BILL-1', 'INV-9001', 'open'),
            ('c3000000-0000-4000-8000-000000000004', $1, $2, 'BILL-2', ' inv-9001 ', 'open')`,
    [companyId, supplierId],
  );

  let failedClosed = false;
  try {
    await applyBundle();
  } catch (error) {
    failedClosed = /Duplicate active supplier invoice references/.test(String(error?.message ?? ''));
    // The bundle opens its own transaction; clear the aborted state before continuing.
    await client.query('ROLLBACK');
  }
  if (!failedClosed) throw new Error('Repair bundle did not fail closed on duplicate supplier invoice references.');
  pass('repair bundle fails closed on duplicate active supplier invoice references');

  // With the conflict resolved, the bundle succeeds and the index is created.
  await client.query("UPDATE public.supplier_bills SET status='void' WHERE id='c3000000-0000-4000-8000-000000000004'");
  await applyBundle();
  if (!(await indexExists('supplier_bills_supplier_invoice_number_unique'))) {
    throw new Error('Unique index was not created after the duplicate was voided.');
  }
  pass('repair bundle succeeds once the conflicting invoice is voided');

  console.log(`\nRehearsal complete: ${results.length} checks passed on ${database}.`);
} finally {
  await client.end().catch(() => {});
}
