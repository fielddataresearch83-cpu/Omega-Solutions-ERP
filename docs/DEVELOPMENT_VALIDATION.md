# Cloud-based development and validation

Omega development is validated in GitHub Actions. A developer workstation is **not required** to build or test the project.

The only development branch is `development`. Do not create test or feature branches. Never point tests or migrations at production or the shared Neon business database.

## Automatic validation

The `Development validation` workflow runs on every push to `development`, on pull requests targeting `development`, and daily at 06:00 East Africa Time (03:00 UTC). It can also be started manually from the GitHub Actions tab.

It performs:

- Node.js setup using the repository's exact `.nvmrc` version.
- API dependency installation, production build, purchase-order approval regression tests, full API tests, and API lint.
- A disposable PostgreSQL 16 service for PostgreSQL-backed MFA tests. The database exists only for the workflow run.
- Frontend dependency installation, production build, and ESLint.
- API and frontend dependency vulnerability reports.

The `Validate Omega development` workflow runs clean-install migration, schema assertion, migration idempotency, and migration safety-guard tests against a separate disposable PostgreSQL database. It runs on relevant code changes, daily at 07:00 East Africa Time (04:00 UTC), and on manual dispatch.

The workforce API and PostgreSQL transaction workflows provide additional focused regression coverage. All GitHub Actions workflows use the Node version in `.nvmrc` to avoid runtime drift.

## Safety boundaries

- CI uses temporary PostgreSQL service containers; it does not use shared Neon or production data.
- Automated validation does not deploy to or reconfigure Render or Vercel.
- No workflow in this validation path automatically deploys production.
- Migration tests run only against disposable CI databases. They do not reconcile or repair the shared database ledger.
- Workflows that create persistent records in shared development services are not part of this automatic validation path and must remain manual/explicitly authorized.

## Local development

Local Node/PostgreSQL setup and the optional local pre-push hook are not required for this cloud-first workflow. GitHub Actions is the authoritative automated validation environment. Developers may still use local tools if they choose, but local checks do not replace the cloud results.

## Required-check enforcement

The repository's `development` branch is currently **not protected**. A green workflow run provides evidence, but does not by itself prevent a direct push.

To enforce the gate, enable a GitHub branch ruleset for `development` and require the relevant status checks after their names have appeared in a successful run. Do not require checks from manual/live workflows. Keep production deployment and shared-database changes behind separate explicit approval.

## Current known debt

- Frontend ESLint has previously been reported with 71 errors and 5 warnings. The frontend lint step is now part of the main cloud validation and will fail until those issues are resolved.
- Dependency audit steps currently report findings without failing the workflow. Review and triage the reports before promoting them to blocking security gates.
- Passing CI proves only the checks that actually ran; it is not proof that every tenant, permission, financial, or production-readiness requirement has been satisfied.

## Operating procedure

1. Make changes only on the existing `development` branch in this private repository.
2. Push the change to GitHub.
3. Wait for all applicable automated checks to finish on the exact commit.
4. Inspect failures and fix them before treating the change as validated.
5. Record the run URL and commit SHA in the production-readiness map.
6. Keep production release, live smoke tests that write records, and shared Neon schema/data changes separate from routine CI.
