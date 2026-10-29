# Omega Solutions

Omega Solutions is a multi-tenant ERP SaaS application under development by Fezaton Enterprises. This repository contains the NestJS API, the Vite/React frontend, an alternate Next.js frontend, database-related assets, and operational documentation.

> **Release status:** The application is under production-readiness audit. A successful build or CI run is not production approval. Do not deploy to production without explicit release authorization.

## Repository layout

- `api/` — NestJS TypeScript API, PostgreSQL access, migrations, and API tests.
- `vite-version/` — React + TypeScript + Vite frontend. Includes the repository's Vite deployment rewrite/security-header configuration.
- `nextjs-version/` — alternate Next.js frontend; do not assume it is the active deployment target.
- `supabase/` — Supabase-related project assets; confirm their current use before changing or deploying them.
- `docs/PRODUCTION_READINESS_MAP.md` — single source of truth for audit scope, verified evidence, open findings, and the next checkpoint.
- `.github/workflows/` — CI and explicitly named development/live smoke workflows. Review each workflow's side effects and target before running it.

## Runtime and package managers

The repository's `.nvmrc` currently specifies Node.js 22.22.3. The validation workflow currently uses Node.js 24, so runtime alignment is an open audit item. Frontend directories contain both npm and pnpm lockfiles; use the lockfile selected by the actual deployment/CI configuration and resolve this ambiguity before changing dependencies.

## Local development

### API

From the repository root:

```sh
cd api
npm ci
npm run build
npm test
npm run lint
```

The API requires the environment variables documented in `api/.env.example`. Use an isolated local/test database for integration tests. Do not point test commands at production or the shared development business database when a test can write data.

### Vite frontend

```sh
cd vite-version
npm ci
npm run build
npm run lint
```

### Alternate Next.js frontend

```sh
cd nextjs-version
```

This directory has its own `package.json` and pnpm lockfile. Its deployment status and canonical package-manager/runtime configuration have not yet been verified.

## CI and safety

The `Development validation` workflow runs on pushes and pull requests targeting `development`, builds/tests/lints the API, builds the Vite frontend, and reports dependency-audit findings. Other workflows may target live services or perform writes; inspect their triggers, required secrets, and side effects before dispatching them. Do not run a workflow that creates, changes, or deletes business records in a shared database as part of a read-only audit.

The current development branch is the only authorized working branch for this audit. Do not create branches, intentionally modify production, or deploy production during the audit. The current branch-protection status and required CI checks are documented in the production-readiness map and remain an open governance item.

## Deployment and operations

Deployment project settings, root directories, build commands, environment scopes, domains, and production/development separation must be verified against the hosting providers before any release. Do not infer those settings from repository files alone. Database migrations and subscription migrations must be reviewed for environment and side effects before execution.

## Audit and release criteria

Track progress in [`docs/PRODUCTION_READINESS_MAP.md`](docs/PRODUCTION_READINESS_MAP.md). Production release requires passing the documented release gates, evidence for security and tenant isolation, financial/stock integrity checks, migration and recovery validation, and explicit authorization from the product owner.
