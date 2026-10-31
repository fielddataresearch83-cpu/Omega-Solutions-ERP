# Local development and pre-push validation

This repository uses the existing `development` branch only. Do not create test or feature branches. Never point local test commands at production or shared Neon business databases.

## One-time setup on Windows PowerShell

1. Pull the latest commit on the existing branch:

   ```powershell
   git checkout development
   git pull --ff-only origin development
   ```

2. Use the exact Node version in `.nvmrc`:

   ```powershell
   node --version
   # Required: v22.22.3
   ```

3. Install dependencies if needed:

   ```powershell
   npm ci --prefix api
   npm ci --prefix vite-version
   ```

4. Create a dedicated disposable local PostgreSQL database for MFA integration tests. Example using the local PostgreSQL role `omega_local`:

   ```powershell
   createdb -U omega_local omega_pre_push_test
   $env:MFA_TEST_DATABASE_URL = "postgres://omega_local:YOUR_LOCAL_PASSWORD@127.0.0.1:5432/omega_pre_push_test"
   ```

   Replace the placeholder locally; never commit credentials. The hook rejects non-local database hosts. Do not use Neon, production, or a database containing business records.

5. Install the hook in this clone:

   ```powershell
   node scripts/install-pre-push-hook.mjs
   git config --get core.hooksPath
   # Expected: .githooks
   ```

The Git hook setting is local to this clone. Install it once in each clone.

## Checks performed before every push

- Exact Node version: `v22.22.3`.
- Current branch is the existing `development` branch.
- `MFA_TEST_DATABASE_URL` exists and points to localhost/127.0.0.1/::1.
- API build, complete API test suite, and API lint.
- Frontend production build and frontend lint.
- `git diff --check` across the commits being pushed.

Any failed check blocks the push. Fix the failure and retry; do not bypass the hook with `--no-verify`. After a push is permitted locally, wait for all applicable GitHub Actions runs on that exact commit to complete successfully before starting another change.

## Known limitations and outstanding CI work

- The hook does not deploy or call Render/Vercel and does not access shared Neon.
- Clean-install migration and disposable PostgreSQL migration-guard checks remain in GitHub Actions; this hook does not run migration commands against a database.
- The previous local audit reported 71 frontend lint errors and 5 warnings. Until those are resolved, the hook is expected to block pushes. That is intentional.
- GitHub Actions workflows still overlap and use different Node versions. This hook does not replace CI; workflow consolidation and branch required-check enforcement remain open tasks.
- A local hook can be bypassed by changing Git configuration or using `--no-verify`; it is a developer-side safety gate, not server-side branch protection. Required checks still need to be enforced in GitHub settings.
