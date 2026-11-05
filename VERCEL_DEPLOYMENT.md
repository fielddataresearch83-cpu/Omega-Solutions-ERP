# Vercel deployment layout

This repository uses Vercel's multi-service configuration in the root `vercel.json`.

## Services

| Service | Root | Public routing |
| --- | --- | --- |
| Vite ERP frontend | `vite-version/` | `/` and application routes |
| NestJS API | `api/` | `/api/*` |
| VitePress documentation | `docs/` | Internal only; no public rewrite |
| Next.js alternative frontend | `nextjs-version/` | Internal only; no public rewrite |

The docs and Next.js services are included in the service configuration but are not exposed through the public routing rules. They may still be built as part of the multi-service deployment.

The Vite frontend calls the API using the same-origin `/api` path. Do not restore hard-coded Render API URLs or set `VITE_API_BASE_URL` to a cross-origin host for this Vercel layout.

## Runtime and environment

- Use Node.js `22.22.3`, matching the repository's `.nvmrc`.
- Configure API secrets only on the API service/server environment. Never put database credentials or JWT secrets in `VITE_*` variables.
- Set `CORS_ORIGINS` to a comma-separated list of any additional approved frontend origins, including a custom domain if one is introduced. The API also permits this project's Vercel preview hostname pattern; it does not permit arbitrary `*.vercel.app` origins.
- Bind preview deployments to the designated development database branch. Production database credentials must not be added to preview environments.

## Database migration policy

Migrations are **manual and reviewed**. Do not run migrations automatically during Vercel builds, service startup, or deployment. Review the migration SQL and target database branch, take/verify an appropriate backup, and obtain explicit approval before applying any migration. This repository configuration does not authorize or perform a database migration.

## Deployment safety

Changes on the `development` branch are configuration/code preparation only. Do not promote them to production, change production environment variables, or deploy to production without separate explicit approval.
