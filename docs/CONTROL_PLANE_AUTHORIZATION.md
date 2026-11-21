# Control-plane table authorization — audit and policy design

**Scope:** every read and write to `company_memberships`, `auth_refresh_tokens`, `company_invitations`, `user_mfa`, `users`, `companies`, `permissions`, `role_permissions`, `subscription_plans` and `auth_rate_limits`, traced through the whole authentication lifecycle. Read-only code review plus disposable-database tests. **No shared development or production database was changed, and no RLS policy was enabled by this work.**

## Method

1. Enumerated table access in `api/src` (excluding specs and migrations).
2. Traced each lifecycle step from controller → service → SQL, and recorded whether a verified tenant context exists at that moment.
3. Cross-checked the context mechanism: `TenantDatabaseContextInterceptor` sets `app.user_id` / `app.company_id` / `app.branch_id` **only** when the JWT strategy produced both a user id and a company id; `DatabaseService.applyTenantContext` writes them with `set_config(..., true)` inside the transaction.
4. Tested the resulting grant design on a disposable PostgreSQL database.

## The context rule that drives everything

`api/src/database/tenant-database-context.interceptor.ts`:

> Unauthenticated bootstrap flows deliberately remain outside tenant scope.

So `app.user_id` and `app.company_id` are **empty** for every unauthenticated endpoint, and `app.company_id` is empty for any authenticated request that has no selected company. Any policy that assumes a tenant context will therefore fail closed — which is correct for tenant tables and catastrophic for authentication.

## Lifecycle matrix

| Step | Endpoint | Authenticated? | Tenant context? | Tables touched | Tables touched pre-context |
|---|---|---|---|---|---|
| Registration | `POST /api/auth/register` | No | **No** | `users` (select+insert), `companies` (insert), `company_memberships` (insert) | all three |
| Login (password) | `POST /api/auth/login` | No | **No** | `users` (select by email), `company_memberships` + `companies` + `branches` (membership), `user_mfa` (status), `auth_refresh_tokens` (insert), `role_permissions` + `permissions` (claims) | all |
| MFA challenge | `POST /api/auth/mfa/challenge` | No (5-minute challenge token) | **No** | `user_mfa` (verify/recovery), `users`, `company_memberships`, `auth_refresh_tokens` | all |
| MFA enrollment / confirm / disable | `POST /api/auth/mfa/{enroll,confirm,disable}` | Yes | **Yes** | `user_mfa` | — |
| MFA status | `GET /api/auth/mfa/status` | Yes | Yes | `user_mfa` | — |
| Refresh | `POST /api/auth/refresh` | **No JWT guard** (refresh token only) | **No** | `user_mfa`, `users`, `company_memberships`, `role_permissions`, `permissions`, `auth_refresh_tokens` (select/update/insert) | all |
| Logout | `POST /api/auth/logout` | **No JWT guard** (refresh token only) | **No** | `auth_refresh_tokens` (update) | — |
| Session validity check | every authenticated request | Yes | Yes | `auth_refresh_tokens` | — |
| Company switching | `POST /api/auth/switch-company` | Yes | Yes (old company) | `users`, `company_memberships` (target company), `auth_refresh_tokens` (revoke old family) | — |
| Invitation acceptance | `POST /api/users-roles/invitations/accept` | Yes | Yes — **but the invitation belongs to a different company than the JWT** | `company_invitations` (select+update), `company_memberships` (insert), `branches` (invited branch), `audit_logs` | write crosses the tenant boundary by design |
| Invitation list/create/revoke | `/api/users-roles/invitations*` | Yes | Yes | `company_invitations`, `users` (inviter name) | — |
| Membership admin | `/api/users-roles/*` | Yes | Yes | `company_memberships`, `users`, `branches`, `role_permissions`, `permissions` | — |
| Membership/branch deactivation | admin action → next request | Yes | Yes | `auth_refresh_tokens` (via `assertActiveSession`) | — |
| Neon identity exchange | `POST /api/auth/neon/{exchange,exchange-invitation,companies}` | No (verified Neon token) | **No** | `users`, `companies`, `company_memberships`, `branches`, `user_mfa`, `auth_refresh_tokens` | all |
| Throttling | `AuthRateLimitGuard` on public auth routes | No | No | `auth_rate_limits` (upsert) | yes |

**Conclusion:** the majority of the control-plane access in the authentication lifecycle happens **before** tenant context exists. Five tables (`users`, `company_memberships`, `user_mfa`, `auth_refresh_tokens`, `companies`) are simultaneously required by pre-tenant authentication *and* by tenant-scoped business queries.

## Why a generic `company_id` policy is wrong here

1. **`users`** has no `company_id`. One identity may hold memberships in several companies.
2. **`user_mfa`** is keyed by `user_id`. Company scope is meaningless, and MFA verification happens with only a 5-minute challenge token.
3. **`auth_refresh_tokens`** is read during refresh and logout, neither of which carries a JWT or a company. A `company_id` policy would make refresh and logout silently no-op — a security *regression*, because revoked families would stop being revoked.
4. **`company_invitations`** acceptance inserts a membership for the *invited* company while the JWT's company is the inviter's or the invitee's current one. A `company_id = app.company_id` policy blocks legitimate acceptance.
5. **`company_memberships`** is read to *derive* the tenant context. A policy depending on that context is circular.

## Table-specific design

### Implemented now — least-privilege grants (`202611210001_control_plane_least_privilege.sql`)

| Table | Class | Grant decision | Rationale |
|---|---|---|---|
| `permissions` | Global catalog | `REVOKE INSERT, UPDATE, DELETE, TRUNCATE`; keep `SELECT` | Read when assembling JWT claims; never written by the app outside migrations |
| `role_permissions` | Global catalog | same | Static role→permission mapping |
| `subscription_plans` | Platform catalog | same | Entitlements live in the RLS-protected `company_subscriptions` |
| `omega_schema_migrations` | Ledger | `REVOKE ALL` | Runner bookkeeping; application never reads it |
| `auth_rate_limits` | Operational/security | keep `SELECT, INSERT, UPDATE, DELETE` | Login throttling depends on it; stores `key_hash CHAR(64)` only, never a raw IP or identifier |
| `companies`, `users`, `company_memberships`, `user_mfa`, `auth_refresh_tokens`, `company_invitations` | Tenant/identity | unchanged; **RLS remains disabled** | Enabling policies today would break login, refresh, logout, MFA verification and invitation acceptance (see below) |

Caveat: `REVOKE` does not constrain a table **owner**. The hardening is only effective when the runtime role is a non-owner with `NOBYPASSRLS` — the same verification that is still open in the readiness map.

### Designed, not yet enabled — policies that preserve pre-tenant flows

The design that keeps every flow working, without weakening isolation:

```sql
-- Identity anchor available to policies (empty before authentication → fail closed).
create or replace function public.omega_current_user() returns uuid
  language sql stable as $$
    select nullif(current_setting('app.user_id', true), '')::uuid
  $$;
```

| Table | Policy | Pre-tenant path preserved by |
|---|---|---|
| `user_mfa` | `user_id = omega_current_user()` for ALL | Authenticated enrollment uses tenant context (user id present). MFA *verification* runs with only a challenge token, so the service must run that call inside a server-set identity context derived from the **verified** challenge token (`sub`), never from request input |
| `auth_refresh_tokens` | `user_id = omega_current_user()` for ALL | `/refresh` and `/logout` must run their queries inside an identity context derived from the **verified** refresh token (`sub`) or, for logout, from the token's own hash lookup |
| `company_memberships` | `user_id = omega_current_user()` (self read/insert) **OR** `company_id = app.company_id AND omega_is_company_admin(...)` | Login/registration/refresh use the identity context; invitation acceptance inserts `user_id = caller`, which the self branch permits |
| `users` | `id = omega_current_user()` **OR** `omega_shares_company(omega_current_user(), id)` | Login/registration/Neon exchange must resolve by **email before identity exists** → a `SECURITY DEFINER` lookup function returning only the columns login needs |
| `companies` | `id = app.company_id OR omega_has_active_membership(omega_current_user(), id)` | Registration inserts a company before any membership exists → allowed only inside a registration identity context |
| `company_invitations` | `company_id = app.company_id AND omega_is_company_admin(...)` **OR** `token_hash = current_setting('app.invitation_token_hash', true)` | Acceptance sets the token-hash setting inside its transaction, then switches `app.company_id` to the invited company for the membership/branch/audit writes — a *narrowing* transition authorised by the invitation itself |

`omega_shares_company`, `omega_has_active_membership` and `omega_is_company_admin` must be `SECURITY DEFINER` with a pinned `search_path`, so policy evaluation does not recurse into the RLS-protected tables they inspect.

**Why these policies are not in this commit:** each requires the application to establish an identity context that does not exist today. Enabling them without that change would make `/refresh` and `/logout` no-ops and block MFA challenge completion, i.e. it would *weaken* session revocation to satisfy a checklist. The app change is specified precisely below and can be reviewed as its own change.

### Required application change before enabling those policies

1. `tenantDatabaseContext` accepts `companyId: null`; `applyTenantContext` sets `app.user_id` whenever present and `app.company_id` only when present (empty string otherwise, so company policies fail closed).
2. `AuthService.login`, `.register`, `.completeMfaChallenge`, `.refresh`, `.revokeRefreshToken` and `.revokeSessionFamily` execute their database work inside an identity context derived from a **server-verified** credential (bcrypt-verified user id, verified challenge `sub`, verified refresh `sub`), never from request fields.
3. `AuthService.login` / `.register` / Neon exchange resolve the email through a `SECURITY DEFINER` function instead of a direct `users` read.
4. `InvitationsService.accept` sets `app.invitation_token_hash` and re-scopes `app.company_id` to the invited company inside its existing transaction.
5. Verification: run the auth lifecycle with the API connected as a `NOBYPASSRLS` role on a disposable database (not the superuser the test suites currently use).

## Findings

1. **No shared isolation was weakened, and none is proposed.** The designed policies add constraints only; they fail closed when context is absent.
2. **Control-plane isolation is currently application-layer only**, and that layer is now partly tested: cross-company membership administration, cross-company invitation listing and revocation, `/users-roles` scoping and session revocation on membership/branch deactivation.
3. **`/refresh` and `/logout` are unauthenticated by design**, so "every request has a tenant context" is false; this is the single most important fact for this design.
4. **Global catalogs are writable by any identity holding DML privileges.** The new migration removes that from the application role and from `PUBLIC`.
5. **The ledger was readable by the application role.** No code path needs it; access is now revoked.

## Test evidence (disposable PostgreSQL 18.7)

| Suite | Result |
|---|---|
| `test/control-plane-least-privilege.e2e-spec.ts` (new) — `NOBYPASSRLS` role created by the suite, pre-granted write access, then hardened by the migration | **6 passed, 0 skipped, 0 failed**: catalog reads allowed; writes to `permissions`, `role_permissions`, `subscription_plans` rejected with `42501`; ledger reads rejected with `42501`; auth throttle writable and readable |
| `test/tenant-cross-company.e2e-spec.ts` + `test/tenant-rls.e2e-spec.ts` | **17 passed, 0 skipped, 0 failed**, including new negatives: another company's invitations are never listed, and revoking one returns 404 with the row unchanged |
| Clean migration replay | 87 migrations apply; the new one is idempotent |
| Role teardown | verified: `omega_app_dev` absent after the suite (no privilege residue) |
