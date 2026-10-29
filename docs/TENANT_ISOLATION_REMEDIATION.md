# Tenant-isolation remediation design

**Status:** Design only. No shared Neon role, policy, schema, or data changes were made.

## Confirmed findings (2026-10-29)

- Read-only catalog inspection found **55 public tables with row-level security enabled and zero policies**.
- Those tables are owned by neondb_owner; relforcerowsecurity is false.
- The inspected Neon session role has rolbypassrls=true. This does not prove the Render API uses that same role; the runtime role remains unverified.
- The API uses a pooled pg.Pool connection. The current database layer does not establish a per-request company/branch context with transaction-local settings.
- Therefore, adding policies alone is unsafe: a non-owner role could see no rows or fail writes, while a BYPASSRLS role can bypass policies. Do not enable or alter policies on the shared database as an experiment.

## Required target architecture

1. **Verify the actual runtime identity safely.** Use a temporary, access-controlled development diagnostic that reports only the connected role's name and rolbypassrls boolean (never the connection string or credentials), or inspect equivalent trusted runtime evidence. Remove the diagnostic after validation.
2. **Create a dedicated least-privilege runtime role.** It must not be a superuser, table owner, or BYPASSRLS role. Keep schema migrations on a separate owner/migration identity. Test role grants and rotation in an isolated database before changing any Render environment variable.
3. **Establish transaction-local request context.** After JWT validation and active membership/branch checks, carry company ID, branch ID, and user ID through request-scoped context (for example, AsyncLocalStorage). The database layer must set SET LOCAL app.company_id, app.branch_id, and app.user_id inside every transaction used for tenant data. Never use connection-wide SET with a pool because the next request could inherit stale tenant context.
4. **Handle unscoped system flows explicitly.** Authentication before company selection, invitation acceptance, platform-owner operations, scheduled jobs, webhooks, and migration execution need separate narrow paths/roles. Do not treat a missing tenant setting as permission to read all rows; policies must fail closed.
5. **Add policies by table class.** Start with simple company_id tables, then child tables whose tenant key is established through a parent relationship. Explicitly review global reference tables, identity/auth tables, subscription/platform tables, and system-maintenance tables. Use both USING and WITH CHECK for reads/updates/inserts as appropriate. Consider FORCE ROW LEVEL SECURITY only after owner/migration workflows are separated and tested.
6. **Test with a non-owner role in ephemeral PostgreSQL.** Include two-company read/update/insert/delete negatives; cross-company foreign keys; branch-bound user access; background jobs; invitation/auth flows; transaction rollback; pooled connection reuse; missing/empty context; and attempts to spoof tenant IDs in payloads.
7. **Stage rollout safely.** Validate the complete migration and policy suite in disposable PostgreSQL, then apply to a dedicated development clone with verified backup/rollback. Verify the runtime role and tenant negatives before any production consideration. Production remains out of scope for this audit.

## Acceptance criteria

- No runtime connection has rolbypassrls=true or owns tenant tables.
- Every tenant table has a reviewed policy and tests for USING and WITH CHECK.
- A missing tenant context denies tenant data access.
- Reusing pooled connections across company A and company B never leaks rows or writes.
- Cross-company and cross-branch negative tests pass with the same role used by the API.
- Auth, invitation, billing, webhooks, scheduled jobs, and platform-owner flows have explicit least-privilege behavior.

## Evidence

The production-readiness tracker records the current RLS catalog findings and the still-unverified Render runtime role. This design does not authorize a shared database change.
