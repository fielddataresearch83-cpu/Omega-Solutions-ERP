import { spawnSync } from 'node:child_process';
import { URL } from 'node:url';

const REQUIRED_NODE = 'v22.22.3';
const ROOT = process.cwd();
const failures = [];

function run(label, command, args, cwd = ROOT) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error || result.status !== 0) {
    console.error(`${label} failed${result.error ? `: ${result.error.message}` : ` with exit code ${result.status ?? 'unknown'}`}.`);
    failures.push(label);
  }
}

if (process.version !== REQUIRED_NODE) {
  console.error(`Required Node.js ${REQUIRED_NODE}; found ${process.version}. Use the repository .nvmrc version before pushing.`);
  process.exit(1);
}

const branch = spawnSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' });
if (branch.status !== 0 || branch.stdout.trim() !== 'development') {
  console.error(`Push blocked: use the existing development branch only (current: ${branch.stdout?.trim() || 'unknown'}).`);
  process.exit(1);
}

const testDatabase = process.env.MFA_TEST_DATABASE_URL;
if (!testDatabase) {
  console.error('Push blocked: set MFA_TEST_DATABASE_URL to a disposable local PostgreSQL test database. Never use shared Neon or production.');
  process.exit(1);
}
try {
  const parsed = new URL(testDatabase);
  if (!new Set(['localhost', '127.0.0.1', '::1', '[::1]']).has(parsed.hostname)) {
    console.error(`Push blocked: MFA_TEST_DATABASE_URL must be local PostgreSQL, not ${parsed.hostname}.`);
    process.exit(1);
  }
} catch {
  console.error('Push blocked: MFA_TEST_DATABASE_URL is not a valid PostgreSQL URL.');
  process.exit(1);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
run('API build', npm, ['run', 'build'], `${ROOT}/api`);
run('API unit and PostgreSQL-backed tests', npm, ['test'], `${ROOT}/api`);
run('API lint', npm, ['run', 'lint'], `${ROOT}/api`);
run('Frontend production build', npm, ['run', 'build'], `${ROOT}/vite-version`);
run('Frontend lint', npm, ['run', 'lint'], `${ROOT}/vite-version`);

const pushedRefs = (process.env.PRE_PUSH_REFS || '').trim().split(/\r?\n/).filter(Boolean);
if (!pushedRefs.length) {
  console.error('Push blocked: pre-push hook did not receive Git ref updates.');
  failures.push('Pushed commit diff validation');
} else {
  for (const refLine of pushedRefs) {
    const [localRef, localSha, , remoteSha] = refLine.trim().split(/\s+/);
    if (!localSha || !remoteSha || /^0+$/.test(localSha) || /^0+$/.test(remoteSha)) {
      console.error(`Cannot safely validate pushed commit range: ${refLine}`);
      failures.push(`Pushed commit diff validation (${localRef || 'unknown ref'})`);
      continue;
    }
    run(`Whitespace and patch validation (${localRef})`, 'git', ['diff', '--check', `${remoteSha}..${localSha}`], ROOT);
  }
}

if (failures.length) {
  console.error(`\nPUSH BLOCKED. Fix these checks before pushing:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\nAll local pre-push checks passed. GitHub Actions must still pass after the push.');
