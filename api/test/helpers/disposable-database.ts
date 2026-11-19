/**
 * Only destructive PostgreSQL integration tests may use this URL.
 * Never fall back to DATABASE_URL: that is the application database and may be shared.
 */
export function getLocalDisposableTestDatabaseUrl(): string | undefined {
  const configured = process.env.OMEGA_TEST_DATABASE_URL;
  if (!configured) {
    if (process.env.DATABASE_URL) {
      throw new Error(
        'Refusing to run destructive database E2E tests with DATABASE_URL. Set OMEGA_TEST_DATABASE_URL to a local disposable *_test database.',
      );
    }
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('OMEGA_TEST_DATABASE_URL must be a valid PostgreSQL connection URL.');
  }

  const hostname = url.hostname.toLowerCase().replace('[', '').replace(']', '');
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);
  const isLocalDisposable = localHosts.has(hostname) && databaseName.endsWith('_test');
  const remoteBranchId = process.env.OMEGA_TEST_DATABASE_BRANCH_ID ?? '';
  const remoteProjectId = process.env.OMEGA_TEST_DATABASE_PROJECT_ID ?? '';
  const remoteExplicitlyAuthorized =
    process.env.OMEGA_TEST_DATABASE_ALLOW_REMOTE === 'I_ACKNOWLEDGE_THIS_IS_A_DISPOSABLE_BRANCH';
  const isExplicitDisposableNeonBranch =
    remoteExplicitlyAuthorized &&
    remoteBranchId === 'br-little-dawn-b4w7sdf2' &&
    remoteProjectId === 'ancient-lake-38155666' &&
    hostname.endsWith('.neon.tech') &&
    databaseName === 'neondb' &&
    url.searchParams.get('sslmode') === 'require';

  if (!isLocalDisposable && !isExplicitDisposableNeonBranch) {
    throw new Error(
      'Refusing destructive database E2E tests: use localhost with a *_test database, or explicitly authorize a disposable Neon branch with OMEGA_TEST_DATABASE_BRANCH_ID, OMEGA_TEST_DATABASE_PROJECT_ID, and OMEGA_TEST_DATABASE_ALLOW_REMOTE.',
    );
  }

  // DatabaseService reads DATABASE_URL. Replace it only after validating the isolated test target.
  process.env.DATABASE_URL = configured;
  return configured;
}


/** True only for local *_test databases; destructive fixture suites are local-only. */
export function isLocalDisposableTestDatabase(): boolean {
  const configured = process.env.OMEGA_TEST_DATABASE_URL;
  if (!configured) return false;
  try {
    const url = new URL(configured);
    const hostname = url.hostname.toLowerCase().replace('[', '').replace(']', '');
    return ['localhost', '127.0.0.1', '::1', 'postgres'].includes(hostname) &&
      decodeURIComponent(url.pathname.slice(1)).endsWith('_test');
  } catch {
    return false;
  }
}

/**
 * Owner connection is reserved for creating/removing the isolated RLS test schema/role.
 * It must point to the exact disposable Neon branch; runtime RLS checks SET ROLE to a
 * dedicated NOBYPASSRLS role and never use the owner role for tenant queries.
 */
export function getDisposableAdminDatabaseUrl(): string | undefined {
  const configured = process.env.OMEGA_TEST_DATABASE_ADMIN_URL;
  if (!configured) return undefined;
  let admin: URL;
  try {
    admin = new URL(configured);
  } catch {
    throw new Error('OMEGA_TEST_DATABASE_ADMIN_URL must be a valid PostgreSQL connection URL.');
  }
  const appUrl = process.env.OMEGA_TEST_DATABASE_URL;
  if (!appUrl) throw new Error('OMEGA_TEST_DATABASE_URL must also identify the disposable test branch.');
  const app = new URL(appUrl);
  const branchId = process.env.OMEGA_TEST_DATABASE_BRANCH_ID ?? '';
  const projectId = process.env.OMEGA_TEST_DATABASE_PROJECT_ID ?? '';
  const authorized = process.env.OMEGA_TEST_DATABASE_ALLOW_REMOTE === 'I_ACKNOWLEDGE_THIS_IS_A_DISPOSABLE_BRANCH';
  const sameTarget = admin.hostname === app.hostname &&
    admin.pathname === app.pathname &&
    admin.searchParams.get('sslmode') === 'require' &&
    app.hostname.endsWith('.neon.tech') &&
    branchId === 'br-little-dawn-b4w7sdf2' &&
    projectId === 'ancient-lake-38155666' &&
    authorized &&
    decodeURIComponent(admin.pathname.slice(1)) === 'neondb';
  if (!sameTarget) {
    throw new Error('Refusing admin fixture connection: it must target the explicitly authorized isolated Neon integration branch.');
  }
  if (decodeURIComponent(admin.username) === 'omega_app_dev') {
    throw new Error('OMEGA_TEST_DATABASE_ADMIN_URL must use the isolated branch owner role, not omega_app_dev.');
  }
  return configured;
}
