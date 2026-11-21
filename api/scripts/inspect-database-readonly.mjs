#!/usr/bin/env node
/**
 * Read-only database inspection for the P0 schema/ledger/RLS findings.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/inspect-database-readonly.mjs
 *
 * Safety contract:
 *   - Requires DATABASE_URL; refuses to guess a target.
 *   - Every statement runs inside `BEGIN TRANSACTION READ ONLY`, so the server
 *     rejects writes even if this script were edited carelessly. Nothing is
 *     committed.
 *   - Prints no connection string, password, or email address. Role names,
 *     object names, counts and booleans only.
 *
 * It answers, without changing anything:
 *   1. Which role is the runtime/session identity, does it bypass RLS, and does it own
 *      any public table (owners bypass their own policies without FORCE RLS)?
 *   2. Does the ledger match the migration source, file by file (counts, gaps, checksums)?
 *   3. Which public tables lack RLS, and which have RLS but no policy?
 *   4. Are the four forward-repair objects (tax snapshots, credit-note line
 *      links, supplier invoice uniqueness index) present?
 *   5. Are there inventory valuation anomalies (zero average cost with
 *      positive-cost inbound history)?
 */
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
  throw new Error('DATABASE_URL is required. This inspection is read-only but still needs an explicit target.');
}

let host = '(unparsed)';
try {
  host = new URL(connectionString).hostname;
} catch {
  /* leave placeholder */
}

const client = new Client({
  connectionString,
  ssl: connectionString.includes('neon.tech') ? { rejectUnauthorized: true } : undefined,
  application_name: 'omega-readonly-inspection',
});

const target = process.env.INSPECT_DATABASE_LABEL || host;
const out = (label, value) => console.log(`${label}: ${value}`);

async function sourceMigrations() {
  const all = (await readdir(migrationsDir)).filter(name => name.endsWith('.sql'));
  const managed = all.filter(name => /^\d+_[a-z0-9_]+\.sql$/i.test(name)).sort(compareMigrationNames);
  const files = await Promise.all(
    managed.map(async filename => ({
      filename,
      checksum: createHash('sha256').update(await readFile(path.join(migrationsDir, filename), 'utf8')).digest('hex'),
    })),
  );
  return { total: all.length, managed: files };
}

const findings = [];
const record = (severity, message) => findings.push({ severity, message });

await client.connect();
try {
  // Hard read-only boundary: the server rejects any write in this transaction.
  await client.query('BEGIN TRANSACTION READ ONLY');
  await client.query("SET LOCAL statement_timeout = '60s'");

  const source = await sourceMigrations();

  console.log('=== TARGET ===');
  out('Target', target);
  out('HTTPS-style TLS', connectionString.includes('neon.tech') ? 'enabled (rejectUnauthorized)' : 'not applied');
  console.log('');

  // ---------- 1. Identity and privilege ----------
  console.log('=== IDENTITY (step 7: runtime role) ===');
  const identity = (
    await client.query(`
      SELECT current_user AS current_user,
             session_user AS session_user,
             current_database() AS database,
             current_setting('server_version') AS server_version,
             r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb
      FROM pg_roles r
      WHERE r.rolname = current_user
    `)
  ).rows[0];
  out('current_user', identity.current_user);
  out('session_user', identity.session_user);
  out('database', identity.database);
  out('server_version', identity.server_version);
  out('rolsuper', identity.rolsuper);
  out('rolbypassrls', identity.rolbypassrls);
  if (identity.rolbypassrls) {
    record('P0', 'The connected role has rolbypassrls=true, so RLS cannot constrain this identity.');
  } else {
    out('RLS enforced for this identity', 'yes (no BYPASSRLS)');
  }
  // Ownership matters even without BYPASSRLS: a table owner is exempt from its own
  // policies unless the table has FORCE ROW LEVEL SECURITY.
  const ownedByCurrentUser = (
    await client.query(
      `SELECT COUNT(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND pg_get_userbyid(c.relowner) = current_user`,
    )
  ).rows[0].count;
  out('public tables owned by current_user', ownedByCurrentUser);
  if (ownedByCurrentUser > 0) {
    record(
      'P0',
      `The connected identity owns ${ownedByCurrentUser} public table(s); a table owner bypasses its own RLS policies unless FORCE ROW LEVEL SECURITY is set.`,
    );
  }

  const appRole = (
    await client.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
       FROM pg_roles WHERE rolname IN ('omega_app_dev', 'omega_app') ORDER BY rolname`,
    )
  ).rows;
  if (appRole.length === 0) {
    out('omega_app_dev role', 'ABSENT in this database');
    record('P1', 'The intended least-privilege application role does not exist in this database.');
  } else {
    for (const role of appRole) {
      const owned = await client.query(
        `SELECT COUNT(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND pg_get_userbyid(c.relowner) = $1`,
        [role.rolname],
      );
      out(
        `role ${role.rolname}`,
        `super=${role.rolsuper} bypassrls=${role.rolbypassrls} login=${role.rolcanlogin} owns_public_tables=${owned.rows[0].count}`,
      );
      if (role.rolbypassrls || role.rolsuper) record('P0', `Role ${role.rolname} bypasses RLS.`);
    }
  }
  // ---------- 1b. Audit-log append-only privileges ----------
  console.log('=== AUDIT LOG PRIVILEGES ===');
  const auditAcl = await client.query(`
    SELECT
      pg_get_userbyid(c.relowner) AS owner,
      has_table_privilege('omega_app_dev', 'public.audit_logs', 'SELECT') AS dev_select,
      has_table_privilege('omega_app_dev', 'public.audit_logs', 'INSERT') AS dev_insert,
      has_table_privilege('omega_app_dev', 'public.audit_logs', 'UPDATE') AS dev_update,
      has_table_privilege('omega_app_dev', 'public.audit_logs', 'DELETE') AS dev_delete,
      has_table_privilege('omega_app_dev', 'public.audit_logs', 'TRUNCATE') AS dev_truncate,
      has_table_privilege('omega_app', 'public.audit_logs', 'UPDATE') AS prod_update,
      has_table_privilege('omega_app', 'public.audit_logs', 'DELETE') AS prod_delete,
      has_table_privilege('omega_app', 'public.audit_logs', 'TRUNCATE') AS prod_truncate
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='audit_logs' AND c.relkind='r'
  `);
  if (!auditAcl.rows.length) {
    out('audit_logs', 'ABSENT');
    record('P1', 'audit_logs table is absent; append-only privileges cannot be verified.');
  } else {
    const acl = auditAcl.rows[0];
    out('audit_logs owner', acl.owner);
    out('omega_app_dev SELECT/INSERT', `${acl.dev_select}/${acl.dev_insert}`);
    out('omega_app_dev UPDATE/DELETE/TRUNCATE', `${acl.dev_update}/${acl.dev_delete}/${acl.dev_truncate}`);
    out('omega_app UPDATE/DELETE/TRUNCATE', `${acl.prod_update}/${acl.prod_delete}/${acl.prod_truncate}`);
    if (acl.dev_update || acl.dev_delete || acl.dev_truncate || acl.prod_update || acl.prod_delete || acl.prod_truncate) {
      record('P1', 'An application role can UPDATE, DELETE or TRUNCATE audit_logs; append-only enforcement is not effective.');
    }
    if (acl.owner === 'omega_app_dev' || acl.owner === 'omega_app') {
      record('P0', `Application role ${acl.owner} owns audit_logs and can bypass ordinary table ACL revokes.`);
    }
  }
  console.log('');

  console.log('');

  // ---------- 2. Migration ledger vs source ----------
  console.log('=== MIGRATION LEDGER (steps 2 and 4) ===');
  out('Migration files on disk', source.total);
  out('Runner-managed files', source.managed.length);
  const ledgerExists = (await client.query("SELECT to_regclass('public.omega_schema_migrations') IS NOT NULL AS ok")).rows[0].ok;
  out('omega_schema_migrations present', ledgerExists);
  if (!ledgerExists) {
    record('P0', 'No migration ledger exists; the schema state is unproven.');
  } else {
    const rows = (await client.query('SELECT filename, checksum FROM omega_schema_migrations')).rows;
    const applied = new Map(rows.map(row => [row.filename, row.checksum]));
    const sourceNames = source.managed.map(entry => entry.filename);
    const missing = source.managed.filter(entry => !applied.has(entry.filename));
    const unknown = rows.filter(row => !sourceNames.includes(row.filename));
    const drift = source.managed.filter(entry => applied.has(entry.filename) && applied.get(entry.filename) !== entry.checksum);
    const gaps = findMigrationLedgerGaps(sourceNames, [...applied.keys()]);

    out('Ledger rows', rows.length);
    out('Applied and matching source', source.managed.length - missing.length - drift.length);
    out('Missing from ledger', missing.length);
    out('Ledger rows with no source file', unknown.length);
    out('Checksum drift', drift.length);
    out('Gaps before later applied migrations', gaps.length);

    // One line per source migration so the ledger comparison is complete, not just a
    // summary. This is the only place every file, checksum and ledger state is joined.
    console.log('  per-migration comparison (source order; checksum is sha256):');
    for (const entry of source.managed) {
      const state = !applied.has(entry.filename)
        ? 'MISSING'
        : applied.get(entry.filename) === entry.checksum
          ? 'applied+match'
          : 'CHECKSUM-DRIFT';
      console.log(`    ${state.padEnd(14)} ${entry.checksum.slice(0, 16)}  ${entry.filename}`);
    }

    if (missing.length) {
      console.log('  missing (in source order):');
      for (const entry of missing) console.log(`    - ${entry.filename}`);
      record('P0', `${missing.length} migration(s) exist in source but not in the ledger.`);
    }
    if (unknown.length) {
      console.log('  ledger-only rows:');
      for (const row of unknown) console.log(`    - ${row.filename}`);
      record('P1', `${unknown.length} ledger row(s) have no source file; ledger is not a trustworthy record.`);
    }
    if (drift.length) {
      console.log('  checksum drift:');
      for (const entry of drift) console.log(`    - ${entry.filename}`);
      record('P0', `${drift.length} applied migration(s) were modified after application.`);
    }
    if (gaps.length) {
      console.log('  interleaved gaps (would replay data-changing SQL on catch-up):');
      for (const name of gaps.slice(0, 20)) console.log(`    - ${name}`);
      record('P0', `${gaps.length} gap(s) precede already-applied migrations; automatic catch-up must stay blocked.`);
    }
    if (!missing.length && !unknown.length && !drift.length && !gaps.length) {
      out('Ledger reconciliation', 'CLEAN (source, ledger and checksums agree)');
    }
  }
  console.log('');

  // ---------- 3. RLS coverage ----------
  console.log('=== RLS COVERAGE (step 5: tables without RLS) ===');
  const tables = (
    await client.query(`
      SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname
    `)
  ).rows;
  const policies = (
    await client.query('SELECT tablename, COUNT(*)::int AS count FROM pg_policies WHERE schemaname = $1 GROUP BY tablename', [
      'public',
    ])
  ).rows;
  const policyByTable = new Map(policies.map(row => [row.tablename, row.count]));
  const withoutRls = tables.filter(table => !table.rls_enabled);
  const rlsNoPolicy = tables.filter(table => table.rls_enabled && !policyByTable.get(table.table_name));
  // Object inventory. Compare these counts with the clean-rebuild baseline recorded in
  // docs/PRODUCTION_READINESS_MAP.md for the current source tree; a lower live count means
  // schema objects are missing even when the ledger looks reconciled.
  const inventory = (
    await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM information_schema.columns
          WHERE table_schema = 'public') AS columns,
        (SELECT COUNT(*)::int FROM pg_indexes WHERE schemaname = 'public') AS indexes,
        (SELECT COUNT(*)::int FROM pg_constraint k JOIN pg_class t ON t.oid = k.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'public') AS constraints,
        (SELECT COUNT(*)::int FROM pg_trigger g JOIN pg_class t ON t.oid = g.tgrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'public' AND NOT g.tgisinternal) AS triggers,
        (SELECT COUNT(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public') AS functions,
        (SELECT COUNT(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'S') AS sequences
    `)
  ).rows[0];
  out('Public base tables', tables.length);
  out(
    'Object inventory',
    `columns=${inventory.columns} indexes=${inventory.indexes} constraints=${inventory.constraints} triggers=${inventory.triggers} functions=${inventory.functions} sequences=${inventory.sequences}`,
  );
  out('RLS enabled', tables.length - withoutRls.length);
  out('RLS enforced for owner', tables.filter(table => table.rls_forced).length);
  out('Policies in public', policies.reduce((sum, row) => sum + row.count, 0));
  out('Tables WITHOUT RLS', withoutRls.length);
  console.log(`  ${withoutRls.map(table => table.table_name).join(', ') || '(none)'}`);
  out('Tables with RLS but NO policy', rlsNoPolicy.length);
  if (rlsNoPolicy.length) console.log(`  ${rlsNoPolicy.map(table => table.table_name).join(', ')}`);
  if (rlsNoPolicy.length) record('P0', `${rlsNoPolicy.length} table(s) have RLS enabled with no policy, which denies all rows to non-bypass roles.`);
  console.log('');

  // ---------- 4. Forward-repair drift probes ----------
  console.log('=== SCHEMA DRIFT PROBES (repair bundle objects) ===');
  const probes = [
    ['invoice_items.tax_treatment', "SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='invoice_items' AND column_name='tax_treatment'"],
    ['quotation_items.tax_treatment', "SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='quotation_items' AND column_name='tax_treatment'"],
    ['supplier_bill_items.tax_treatment', "SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='supplier_bill_items' AND column_name='tax_treatment'"],
    ['credit_note_items.invoice_item_id', "SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_note_items' AND column_name='invoice_item_id'"],
    ['credit_note_items.tax_treatment', "SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_note_items' AND column_name='tax_treatment'"],
    ['supplier_bills_supplier_invoice_number_unique', "SELECT COUNT(*)::int AS n FROM pg_indexes WHERE schemaname='public' AND indexname='supplier_bills_supplier_invoice_number_unique'"],
  ];
  const missingObjects = [];
  for (const [label, sql] of probes) {
    const present = (await client.query(sql)).rows[0].n > 0;
    out(label, present ? 'present' : 'ABSENT');
    if (!present) missingObjects.push(label);
  }
  if (missingObjects.length) {
    record('P0', `Repair bundle still required for: ${missingObjects.join(', ')}.`);
  }
  const duplicates = (
    await client.query(`
      SELECT COUNT(*)::int AS groups FROM (
        SELECT 1 FROM supplier_bills
        WHERE status <> 'void' AND NULLIF(BTRIM(supplier_invoice_number), '') IS NOT NULL
        GROUP BY company_id, supplier_id, LOWER(BTRIM(supplier_invoice_number))
        HAVING COUNT(*) > 1
      ) g
    `)
  ).rows[0].groups;
  out('Duplicate active supplier invoice groups', duplicates);
  if (duplicates > 0) record('P0', `${duplicates} duplicate supplier invoice group(s) block the unique index.`);
  console.log('');

  // ---------- 5. Inventory valuation anomalies ----------
  console.log('=== INVENTORY VALUATION (step 3, read-only) ===');
  const anomalies = (
    await client.query(`
      SELECT COUNT(*)::int AS count
      FROM inventory_stock_levels s
      WHERE s.quantity > 0
        AND COALESCE(s.average_unit_cost, 0) = 0
        AND EXISTS (
          SELECT 1 FROM inventory_stock_movements m
          WHERE m.company_id = s.company_id
            AND m.product_id = s.product_id
            AND m.warehouse_id = s.warehouse_id
            AND m.quantity > 0
            AND m.unit_cost > 0
        )
    `)
  ).rows[0].count;
  out('Positive-stock levels with zero average cost and positive-cost inbound history', anomalies);
  if (anomalies > 0) {
    record('P1', `${anomalies} stock level(s) hold a zero weighted-average cost despite positive-cost inbound movements.`);
  }
  console.log('');

  await client.query('ROLLBACK');

  console.log('=== SUMMARY ===');
  if (findings.length === 0) {
    console.log('No findings. Ledger, RLS coverage, repair objects and valuation agree with the source of truth.');
  } else {
    for (const finding of findings) console.log(`[${finding.severity}] ${finding.message}`);
  }
  console.log(`Mode: READ ONLY (transaction rolled back). Findings: ${findings.length}.`);
  if (findings.some(finding => finding.severity === 'P0')) process.exitCode = 2;
} finally {
  await client.end();
}
