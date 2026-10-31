import { spawnSync } from 'node:child_process';

const branch = spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' });
if (branch.status !== 0 || branch.stdout.trim() !== 'development') {
  console.error('Refusing hook installation: checkout the existing development branch first.');
  process.exit(1);
}
const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
const verify = spawnSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' });
if (verify.status !== 0 || verify.stdout.trim() !== '.githooks') {
  console.error('Could not verify Git hooks configuration.');
  process.exit(1);
}
console.log('Installed local Git hooks path: .githooks');
console.log('The pre-push hook will block pushes when any required local check fails.');
