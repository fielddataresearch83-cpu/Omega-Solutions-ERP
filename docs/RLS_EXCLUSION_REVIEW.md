# Tables without row-level security — classification and safeguards

**Scope:** Source-derived review of every public table the migration tree creates, cross-checked against a clean disposable PostgreSQL rebuild on 2026-11-21. **No shared database was queried or changed in this review**; the live-catalog equivalent is produced by `api/scripts/inspect-database-readonly.mjs`.

## Why the inventory is exactly 11

`202611120004_company_rls_policies.sql` does not enumerate tables. It loops over every public table that has a `company_id` column and applies `omega_company_isolation`, deliberately excluding three control-plane tables named in the migration header. Therefore:

| Bucket | Count |
|---|---|
| Public base tables created by migrations | 120 |
| `omega_schema_migrations` (created by the runner, not a migration) | 1 |
| Company-scoped tables protected by the loop | 110 |
| **Tables without RLS** | **11** |

Clean-rebuild verification (`omega_ci_test`, disposable): 121 public base tables, 110 with RLS, **110 policies**, 0 tables with RLS but no policy, **11 tables without RLS** — the list below, exactly. The prior audit's "110/113 company-scoped protected" and the live "11 tables without RLS" figures therefore reconcile with the source; they are the same 11 objects.

## The 11 tables

| # | Table | Class | Why it has no policy | How authorization currently protects it | Additional safeguard still needed |
|---|---|---|---|---|---|
| 1 | `companies` | Tenant registry | A policy keyed on `company_id` is meaningless when the table's key *is* `company_id` (column is `id`) | Every tenant route resolves an active membership before use; `/companies` returns the caller's memberships only | Add `id = current_setting('app.company_id')` policy so a scoped role cannot enumerate other tenants |
| 2 | `users` | Global identity | One person may hold memberships in several companies; auth must read the row before a tenant exists | Login/MFA reads by id/email only; user administration joins through `company_memberships` scoped by the actor's company | Policy exposing only users sharing an active membership, or a scoped view; verify no route lists users directly |
| 3 | `user_mfa` | Per-user secret | Keyed by `user_id`, not `company_id` | Every write resolves the user from the verified JWT; service never accepts a caller-supplied user id | Add `user_id = current_setting('app.user_id')` policy; confirm no admin path returns secrets |
| 4 | `auth_refresh_tokens` | **Control plane** (`company_id` present but excluded) | Refresh happens before any company context; a company-scoped policy would break session refresh | Token stored hashed, scoped to the issuing user; deactivated membership/branch revokes the session (covered by tenant-isolation tests) | Policy keyed on `user_id`; ensure no path can mint tokens for another user's id |
| 5 | `company_invitations` | **Control plane** (`company_id` present but excluded) | Invitation acceptance is unauthenticated-pre-context; `company_id` is not yet available | Acceptance requires an unguessable single-use token; listing/creation require `users:write` and owner/admin membership of the actor's company | Policy on `company_id` for the authenticated admin paths, with acceptance on a narrow separate path/role |
| 6 | `company_memberships` | **Control plane** (`company_id` present but excluded) | Auth resolves membership *to obtain* the tenant context, so a policy would be circular | Every management query filters `company_id = actor.companyId`; cross-company suspend/role-change returns 404 with the target unchanged (new test) | Add a policy permitting rows where the caller's membership is the row, plus self-company admin rows |
| 7 | `permissions` | Global catalog | Read-only reference data shared by all tenants | Only read at JWT assembly; no tenant data | `REVOKE INSERT, UPDATE, DELETE` from the runtime role |
| 8 | `role_permissions` | Global catalog | Mapping of static roles to static permissions | Read-only; no tenant data | `REVOKE INSERT, UPDATE, DELETE` from the runtime role |
| 9 | `subscription_plans` | Platform catalog | Pricing catalog shared across tenants; `company_subscriptions` (protected) references it | Read-only for the app; entitlements resolve through the company-scoped `company_subscriptions` | `REVOKE INSERT, UPDATE, DELETE` from the runtime role |
| 10 | `auth_rate_limits` | Operational/security | Not tenant data; keyed by hashed identifier | Written and read only by the auth rate limiter; no business data, no PII stored in clear | Confirm no identifiers are stored in clear and add a retention/TTL cleanup task |
| 11 | `omega_schema_migrations` | Migration ledger | Runner bookkeeping; the runner owns it | Never read by application code | `REVOKE ALL` from the runtime role; owner-only |

## Verdict

- **Intentionally global (5):** `companies`, `users`, `user_mfa`, `permissions`, `role_permissions`, `subscription_plans`, `auth_rate_limits` are not tenant-partitioned by design — 7 objects across 6 classes; RLS cannot express their isolation as a company predicate alone.
- **Intentionally control-plane (3):** `company_memberships`, `auth_refresh_tokens`, `company_invitations` carry `company_id` but are excluded on purpose because authentication must read them before tenant context exists. Their isolation is an application responsibility, and that responsibility is now partly covered by tests (cross-tenant membership administration, cross-company `/users-roles` scoping, session revocation on membership and branch deactivation).
- **Bookkeeping (1):** `omega_schema_migrations`.

**None of the 11 is an accidental omission from the loop.** The genuine open risk is not the exclusion list but the *runtime identity*: if the API connects as a role with `rolbypassrls` (or as the table owner without `FORCE ROW LEVEL SECURITY`), then all 110 policies are inert and the application's own `WHERE company_id = $1` predicates become the only boundary. That is why the runtime-role confirmation remains a P0 release blocker — see the readiness map and `docs/TENANT_ISOLATION_REMEDIATION.md`.

## How to re-verify on the real database

```
DATABASE_URL=... node api/scripts/inspect-database-readonly.mjs
```

The script runs every query inside `BEGIN TRANSACTION READ ONLY`, prints role name / `rolbypassrls` / table counts but no connection string or credentials, and exits non-zero when a P0 finding is present. It was validated on a disposable rebuild: clean database → 11 exclusions and no other findings; after deliberately removing two ledger rows, dropping the supplier-invoice index and dropping `invoice_items.tax_treatment`, it reported exactly those two missing migrations, two interleaved gaps, and both absent objects.
