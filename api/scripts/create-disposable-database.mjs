// Create a disposable local *_test PostgreSQL database for destructive E2E suites.
// Usage: DATABASE_ADMIN_URL=postgres://user:pass@localhost:5432/postgres \
//          node scripts/create-disposable-database.mjs omega_app_rls_test
//
// Safety: refuses to run against anything that is not loopback and refuses database
// names that do not end in "_test", so this can never target a shared or production host.
import pg from 'pg';

const target = process.argv[2];
if (!target) {
  throw new Error('Usage: node scripts/create-disposable-database.mjs <database_name_test>');
}
if (!/^[a-z0-9_]+_test$/.test(target)) {
  throw new Error('Refusing to create a database whose name does not end in "_test".');
}

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  throw new Error('DATABASE_ADMIN_URL is required (for example postgres://postgres:postgres@localhost:5432/omega_ci_test).');
}

const parsed = new URL(adminUrl);
const host = parsed.hostname.toLowerCase().replace('[', '').replace(']', '');
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error('Refusing to create a disposable database on a non-loopback host.');
}

const { Client } = pg;
const client = new Client({ connectionString: adminUrl });
try {
  await client.connect();
  const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [target]);
  if (existing.rowCount) {
    console.log(`Database ${target} already exists.`);
  } else {
    // Identifier is validated above; CREATE DATABASE cannot be parameterised.
    await client.query(`CREATE DATABASE "${target}"`);
    console.log(`Created disposable database ${target}.`);
  }
} finally {
  await client.end();
}
