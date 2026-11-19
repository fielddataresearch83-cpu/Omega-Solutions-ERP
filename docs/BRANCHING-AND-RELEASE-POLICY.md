# Omega Solutions ERP — Branching and Release Policy

## Branches

- `development` is the sole day-to-day working branch. Feature work, fixes, integration, and development testing happen here.
- `main` is the production release branch. Create it only when a release candidate is ready and after Vercel's Production Branch has been changed from `development` to `main` in both existing projects.
- Do not create additional feature or working branches unless explicitly approved.
- Do not force-push, rewrite history, reset shared branches, or discard existing work.

## Vercel

- Keep the existing frontend project `omega-solutions-erp` and API project `omega-solutions-erp-9k9s`; do not create replacement projects.
- `development` must produce Preview deployments only.
- `main` is the only Production deployment branch.
- Before any push, verify the Production Branch setting on both projects. If either project still treats `development` as Production, do not push.
- Production releases require explicit approval. Do not promote, deploy to Production, or change production domains without approval.

## Databases and migrations

- Development and test work must use the designated development Neon database/branch and development-only secrets.
- Never use the production database for development, tests, or migration rehearsals.
- Migrations are manual: prepare, review, and test on an isolated disposable Neon branch first.
- Production migrations require a separately reviewed plan, verified backup/recovery path, and explicit user approval. Never run migrations automatically as part of a deployment.

## Release sequence

1. Complete and test changes on `development`.
2. Validate builds, unit tests, tenant/RLS isolation, and relevant end-to-end flows.
3. Verify both Vercel projects use `main` as Production Branch and `development` as Preview.
4. Create `main` from the approved, tested `development` commit.
5. Review and approve any production migration plan separately; execute migrations manually only after approval.
6. Release from `main` only with explicit approval, then verify application health.

## Current safety hold

Until both Vercel Production Branch settings are verified as `main`, do not push commits from the current `development` branch. Continue local/cloud-workspace development and testing only.
