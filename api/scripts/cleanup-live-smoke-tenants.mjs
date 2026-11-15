import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.OMEGA_ISOLATED_TEST_DATABASE_URL;
const approvedBranch = process.env.OMEGA_ISOLATED_TEST_DATABASE_BRANCH;

if (!databaseUrl) throw new Error("OMEGA_ISOLATED_TEST_DATABASE_URL is required.");
if (!approvedBranch || !/^omega-erp-e2e-[a-z0-9-]+$/.test(approvedBranch)) {
  throw new Error("Refusing cleanup: OMEGA_ISOLATED_TEST_DATABASE_BRANCH must be a disposable omega-erp-e2e-* branch. Shared Development and Production branches are forbidden.");
}
if (process.env.OMEGA_CLEANUP_TEST_TENANTS_CONFIRM !== "YES") {
  throw new Error("Refusing cleanup without OMEGA_CLEANUP_TEST_TENANTS_CONFIRM=YES.");
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: /neon\.tech/i.test(databaseUrl) ? { rejectUnauthorized: false } : undefined,
  max: 1,
  connectionTimeoutMillis: 10000,
});
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query("SET LOCAL statement_timeout = '20s'");
  await client.query("SET LOCAL lock_timeout = '5s'");
  const identity = await client.query("SELECT current_database() AS database_name");
  if (identity.rows[0]?.database_name !== "neondb") {
    throw new Error(`Refusing cleanup: expected database neondb, got ${identity.rows[0]?.database_name}`);
  }

  const candidates = await client.query(`
    SELECT c.id, c.name, u.id AS user_id, u.email
    FROM companies c
    JOIN company_memberships m ON m.company_id = c.id
    JOIN users u ON u.id = m.user_id
    WHERE (
      (c.name ~ '^Omega E2E [0-9]{13}$' AND u.email = 'omega-e2e-' || substring(c.name from '([0-9]{13})$') || '@example.com')
      OR (c.name ~ '^Omega HRM E2E [0-9]{13}$' AND u.email = 'omega-hrm-e2e-' || substring(c.name from '([0-9]{13})$') || '@example.com')
      OR (c.name ~ '^Omega Payroll E2E [0-9]{13}$' AND u.email = 'payroll-e2e-' || substring(c.name from '([0-9]{13})$') || '@example.com')
      OR (c.name ~ '^Payment Regression owner [0-9]{13}$' AND u.email = 'pay-regression-owner-' || substring(c.name from '([0-9]{13})$') || '@example.com')
      OR (c.name ~ '^Payment Regression other [0-9]{13}$' AND u.email = 'pay-regression-other-' || substring(c.name from '([0-9]{13})$') || '@example.com')
    )
    AND (SELECT COUNT(*) FROM company_memberships mx WHERE mx.user_id = u.id) = 1
    AND (SELECT COUNT(*) FROM company_memberships mm WHERE mm.company_id = c.id) = 1
  `);
  if (candidates.rowCount > 300) throw new Error(`Refusing cleanup: ${candidates.rowCount} candidates exceeds the 300-tenant safety ceiling.`);

  const unsafe = await client.query(`
    SELECT c.id FROM companies c
    JOIN company_memberships m ON m.company_id = c.id
    JOIN users u ON u.id = m.user_id
    WHERE c.name ~ '^(Omega E2E|Omega HRM E2E|Omega Payroll E2E|Payment Regression (owner|other)) [0-9]{13}$'
      AND u.email ~ '^(omega-e2e|omega-hrm-e2e|payroll-e2e|pay-regression-owner|pay-regression-other)-[0-9]{13}@example[.]com$'
      AND (SELECT COUNT(*) FROM company_memberships mx WHERE mx.user_id = u.id) <> 1
  `);
  if (unsafe.rowCount) throw new Error("Refusing cleanup: a test-pattern user is shared across company memberships.");

  const companyIds = candidates.rows.map(row => row.id);
  const userIds = [...new Set(candidates.rows.map(row => row.user_id))];
  if (companyIds.length) {
    await client.query("DELETE FROM payroll_items WHERE company_id = ANY($1::uuid[])", [companyIds]);
    const deleted = await client.query("DELETE FROM companies WHERE id = ANY($1::uuid[])", [companyIds]);
    if (deleted.rowCount !== companyIds.length) throw new Error("Company deletion count mismatch.");
    await client.query(
      "DELETE FROM users u WHERE u.id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM company_memberships m WHERE m.user_id = u.id)",
      [userIds],
    );
  }

  const remaining = await client.query(`
    SELECT COUNT(*)::int AS count FROM companies
    WHERE name ~ '^(Omega E2E|Omega HRM E2E|Omega Payroll E2E|Payment Regression (owner|other)) [0-9]{13}$'
  `);
  if (Number(remaining.rows[0].count) !== 0) throw new Error("Cleanup verification failed: matching test companies remain.");
  await client.query("COMMIT");
  console.log(JSON.stringify({
    result: "PASS",
    branch: approvedBranch,
    database: identity.rows[0].database_name,
    deletedCompanies: companyIds.length,
    deletedDedicatedUsers: userIds.length,
    matchingCompaniesRemaining: Number(remaining.rows[0].count),
  }, null, 2));
} catch (error) {
  await client.query("ROLLBACK");
  console.error("Test-tenant cleanup rolled back:", error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
