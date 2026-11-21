# Omega Solutions — Production Readiness Map

> **Single source of truth for the production-readiness audit.** Update this file as work is completed so the same checks are not repeated.
>
> Repository: [fielddataresearch83-cpu/Omega-Solutions-ERP](https://github.com/fielddataresearch83-cpu/Omega-Solutions-ERP)
> Source repository `pestria72-code/Omega-Solutions` is not to be modified.  
> Working branch: `development` only  
> Current workspace HEAD: `0f3adcb48ac2993b6bf5a68d8c2361dc70b139fe` (2026-11-17 audit; two local commits ahead of `origin/development`; company-timezone DTO validation remains uncommitted)
> Status: **AUDIT IN PROGRESS — not approved for production**

## Operating rules

1. Work only on the existing `development` branch. **Never create a branch** for testing, fixes, previews, or experiments.
2. Do not intentionally change, deploy to, or mutate production. Do not use production data for tests.
3. Do not mutate business data in the shared development database during audit. Use isolated/disposable test databases or controlled fixtures for tests that require writes.
4. Do not add demo/sample business data or bypass authentication. Do not use the prohibited dashboard E2E account.
5. Inspect and document evidence before changing code. Fix one coherent issue at a time, add/regress tests, and run relevant CI before moving on. **Do not push unvalidated code.** Run the local pre-push gate first; if a check fails, stop and fix it before pushing. Push one coherent, locally verified commit to the existing `development` branch, then wait for every applicable GitHub Actions workflow to complete successfully before starting the next change. A successful workflow run validates only the commit and checks it actually ran.
6. Never mark an item complete because code exists or a page renders. Mark it complete only after its acceptance criteria have been verified and evidence is recorded below.
7. Do not run the unrelated **“Deploy Template to ShadcnStore”** workflow. Audit workflow targets before triggering any deployment workflow.
8. No production deployment until all release gates pass and the user explicitly authorizes release.
9. Never place secrets, access tokens, private customer data, or sensitive environment values in this file.

## How the checklist is maintained

- Use `- [ ]` for not verified, `- [x]` only for verified completion.
- When finishing a task, immediately check it off **in this file**, record the evidence (test command/result, CI run, relevant commit or file/line), and update the current checkpoint.
- If a check fails, keep it unchecked and add a finding with severity, impact, reproduction/evidence, owner/action, and status.
- If evidence becomes stale after related code changes, reopen the affected item.
- Before each session, read **Current checkpoint**, **Open findings**, and the relevant module section first. Continue from the first unchecked high-priority item; do not restart completed checks without a reason.
- “Not applicable” requires a written reason and reviewer confirmation; it is not equivalent to verified.
- This is a manually maintained Markdown checklist; it is not a GitHub Actions automation. Update it after each completed/verified task. Do not mark tasks complete based only on a passing general CI run.
- GitHub Actions runs are validation evidence, not a mechanism for selecting or pushing code. The repository currently has overlapping workflows and differing Node versions; record this as an open CI-governance issue until a safe consolidation is locally tested. Do not use direct GitHub Contents API commits as a substitute for local pre-push validation.
- Do not run workflows that alter Neon Auth configuration, mutate shared business data, send messages, or interact with Render/Vercel. Manual live workflows require a separate explicit authorization and side-effect review.

## P0-2 implementation checkpoint — 2026-11-21

**What changed (branch `development`)**

| Commit | Change |
|---|---|
| `2be8b040` | New `api/test/tenant-cross-company.e2e-spec.ts` (9 negative tests: BOLA read/write/delete, client-supplied tenant identifiers, `/users-roles` scoping, company-switch rejection, role permission boundaries, branch-bound accounting denial, per-company session scoping) and `api/scripts/create-disposable-database.mjs`. `application-rls` may now use a dedicated `omega_app_rls_test` database. |
| `f9ef9102` | CI fix: the development workflow never applied migrations to its `postgres:16` service container, so the new suite failed in [run 44895403575](https://github.com/fielddataresearch83-cpu/Omega-Solutions-ERP/actions/runs/44895403575). Added an explicit migration step for the disposable CI database. |
| `851ddd31` | P0-4 hardening: `configure-neon-auth-verification` (PATCHes hosted Neon Auth), `finance-planning-write-acceptance` (writes financial records) and `preview-acceptance` (exercises shared Preview) no longer run on routine pushes. |

**Executed locally on a disposable PostgreSQL 18.7 cluster (no shared database touched)**

- `tenant-cross-company.e2e-spec.ts` + `tenant-rls.e2e-spec.ts`: **12 passed, 0 skipped, 0 failed**. Cross-company suite transiently asserted the wrong expectation once (`staff` legitimately holds `customers:write` per `005_seed_permissions.sql`); the test was corrected, not the application.
- `application-rls.e2e-spec.ts` against a dedicated empty database: **4 passed, 0 skipped, 0 failed**.
- Reproduced the CI failure from an empty database, then proved the corrected workflow sequence passes from zero tables: migrate → 12 passed → 4 passed.
- `npm run build`, `npm run lint`, unit suite: **585 passed, 2 skipped**.

**Still open for P0-2 (do not mark SEC-01…SEC-13 complete)**

- CI evidence on the release-candidate commit is required; local execution is not CI evidence.
- `company_memberships`, `auth_refresh_tokens` and `company_invitations` remain outside RLS and rely on application checks; the membership/invitation negative matrix is still incomplete.
- Runtime `DATABASE_URL` role (`NOBYPASSRLS`) is unconfirmed. `vercel.json` deploys the API as a Vercel service (`/api/*` → `api`), while 2026-10-29 metadata described a Render service; confirm which platform serves the API before verifying its environment.

## P0-1 rehearsal checkpoint — 2026-11-21

`api/scripts/rehearse-schema-forward-repair.mjs` now rehearses `docs/DEVELOPMENT_SCHEMA_FORWARD_REPAIR.sql` on a disposable local database. It installs all migrations, simulates the documented drift (tax snapshot columns, credit-note line links, supplier uniqueness index), applies the bundle, verifies postconditions, re-applies it for idempotency, and proves fail-closed behaviour on duplicate active supplier invoice references.

Local result: **6/6 checks passed** on `omega_forward_repair_test`. The rehearsal is wired into `development-validation.yml` as a standing regression.

**No migration has been applied to the shared development or production database.** Applying the bundle to shared still requires: an isolated clone rehearsal on the actual drifted schema, a catalog diff, a backup, and explicit owner approval.

## P0-2/P0-3 continuation checkpoint — 2026-11-21 (later session)

- Added two more application-layer negatives: a deactivated membership immediately revokes an existing session (401 then 200 after restoration) and a deactivated branch revokes a branch-bound session. Tenant-isolation step now executes **14 tests (11 cross-company + 3 synthetic RLS)**, 0 skipped.
- `api/scripts/report-inventory-cost-anomalies.mjs` reports positive-stock levels whose persisted weighted-average cost is zero despite positive-cost inbound history. Read-only (`BEGIN READ ONLY`), prints no credentials.
- `api/scripts/rehearse-inventory-cost-repair.mjs` rehearses the reviewed per-stock-level correction on a disposable database: recomputes from inbound movements (110.0000/unit for the synthetic 4 units / 440 value anomaly), is idempotent, refuses already-valued levels, and refuses levels without positive-cost inbound history. **6/6 checks passed.**
- Both rehearsals run in `development-validation.yml`; the cost correction is **not** applied to any shared database.

## P0-1/P0-2/P0-4 checkpoint — 2026-11-21 (shared-database verification attempt)

**What was attempted:** verify the shared development database's migration ledger, schema drift, financial anomalies and runtime role using read-only queries only, then reconcile against the migration source without marking anything applied.

**What actually happened:** this workspace has **no shared-database credential and no hosting token** (`DATABASE_URL`, `NEON_*`, `VERCEL_*` all unset; only `.env.example` files exist; `vercel` CLI absent; `gh` not authenticated). Steps requiring the live database or Vercel environment therefore **could not be executed**, and are reported as blocked rather than inferred. No shared or production resource was touched.

**Deliverable that closes the gap safely:** `api/scripts/inspect-database-readonly.mjs`. Run it with the development branch's connection string and it reports, inside `BEGIN TRANSACTION READ ONLY`: session role, `rolsuper`/`rolbypassrls`, ledger-vs-source reconciliation (missing files, ledger-only rows, checksum drift, interleaved gaps), RLS coverage per table, the four forward-repair objects, duplicate active supplier-invoice groups, and the inventory valuation anomaly count. It prints no connection string or credentials and exits non-zero on any P0 finding.

**Validation of that tool (disposable PostgreSQL 18.7, no shared database):**

| Scenario | Result |
|---|---|
| Clean rebuild (`omega_ci_test`, 86 migrations) | 86/86 ledger entries, 0 missing, 0 ledger-only, 0 checksum drift, 0 gaps; 121 public tables, 110 with RLS, 110 policies, **11 without RLS**; all repair objects present; 0 duplicates; 0 valuation anomalies |
| Deliberate drift (`omega_inspect_test`: 2 ledger rows deleted, supplier-invoice index dropped, `invoice_items.tax_treatment` dropped) | Detected **exactly** the 2 missing migrations, 2 interleaved gaps, and both absent objects → exit 2 |

**Source-side reconciliation (steps 2 and 4, without a live ledger):**

- 86 runner-managed migration files, 0 excluded by the runner's filename pattern.
- Duplicate numeric prefixes exist by design: `008` (crm foundation, products/sales), `024` (workforce foundation first, then attendance assignments) and `20261022` (three files). `compareMigrationNames` resolves them deterministically, foundation-first.
- The historical shared-database drift is **not** a count mismatch to be normalised: the 2026-10-29 inspection found 48 ledger rows against 66 source files with 18 interleaved gaps, and today's tree has 86 files. Marking files applied to close the gap would replay data-changing SQL (notably `032_inventory_weighted_average_cost.sql`, which backfills cost). The runner's gap guard must stay enabled, and reconciliation must follow `docs/MIGRATION_LEDGER_RECONCILIATION.md`.
- No ledger row was added, removed or corrected for any shared database.

**RLS exclusions (step 5):** the 11 tables without RLS are enumerated and classified in [RLS_EXCLUSION_REVIEW.md](RLS_EXCLUSION_REVIEW.md): 7 intentionally global (`companies`, `users`, `user_mfa`, `permissions`, `role_permissions`, `subscription_plans`, `auth_rate_limits`), 3 intentional control-plane exclusions (`company_memberships`, `auth_refresh_tokens`, `company_invitations`, named in the RLS migration header), and the `omega_schema_migrations` ledger. The exclusion list matches the live count of 11 exactly, so none of them is an accidental omission. The dominant risk is therefore the runtime identity, not the list.

**Branch protection (step 6):** `development` is still `protected: false` (re-checked 2026-11-21). The exact rule — required PR with 1 approval, stale-approval dismissal, last-push approval, strict required check `validate`, conversation resolution, linear history, no force-push, no deletion, administrators included, restricted pushers — is documented with its equivalent `gh api` call in [BRANCHING-AND-RELEASE-POLICY.md](BRANCHING-AND-RELEASE-POLICY.md). Not applied: it needs repository administration.

**Deployment topology correction:** the root `vercel.json` declares four Vercel services (`api` NestJS, `vite-version`, `docs` VitePress, `nextjs-version`) and rewrites `/api/*` to the `api` service. Earlier map entries assuming a Render-hosted API are historical; which platform currently serves the API, and which environment holds `DATABASE_URL`, must be confirmed before the runtime-role check.

**Blocked, with the exact unblocking action:**

1. Ledger/schema/valuation/role verification on shared development — owner provides a **read-only** connection string for the development branch (or runs the inspection script and shares its output). No mutation is implied.
2. Vercel runtime configuration — owner reads the API project's Development/Preview `DATABASE_URL` role name in the dashboard and confirms host/branch; the value must not be pasted anywhere.
3. Branch protection — repository admin applies the documented rule.

## Control-plane authorization checkpoint — 2026-11-21

**Full audit and design:** [CONTROL_PLANE_AUTHORIZATION.md](CONTROL_PLANE_AUTHORIZATION.md). Ten tables traced through the complete authentication lifecycle; no shared or production database touched.

**The finding that governs the design:** the majority of control-plane access happens **before** tenant context exists. `POST /api/auth/refresh` and `POST /api/auth/logout` carry no JWT at all (refresh token only), and registration, password login, MFA challenge completion and the Neon identity exchange all run outside tenant scope. Five tables (`users`, `company_memberships`, `user_mfa`, `auth_refresh_tokens`, `companies`) are required by pre-tenant authentication *and* by tenant-scoped business queries. A generic `company_id` policy on them would make refresh and logout silent no-ops — weakening session revocation — and would block MFA verification and invitation acceptance.

**Implemented (safe, verified):** `202611210001_control_plane_least_privilege.sql` revokes write access to the global catalogs (`permissions`, `role_permissions`, `subscription_plans`) and all access to `omega_schema_migrations` from the application roles and from `PUBLIC`, while leaving `auth_rate_limits` writable because login throttling depends on it. It enables no RLS policy, changes no row, and alters no application behaviour. Owner-role caveat recorded: `REVOKE` does not constrain a table owner, so this only binds once the runtime role is a non-owner with `NOBYPASSRLS`.

**Designed, deliberately not enabled:** table-specific policies keyed on an identity anchor (`app.user_id`) rather than `company_id`, plus `SECURITY DEFINER` lookup helpers for the genuinely pre-identity paths (email login/registration, invitation token acceptance). Enabling them requires the application to establish a verified identity context first; that dependency chain is written out step by step in the design document. Shipping the policies without it would break authentication, so they are held back rather than applied unverified.

**Tests added:**

- `test/control-plane-least-privilege.e2e-spec.ts` — creates its own `NOBYPASSRLS` role, pre-grants broad access, applies the hardening migration, then proves catalog reads succeed while writes to all three catalogs and reads of the ledger fail with `42501`; the auth throttle stays writable. **6 passed, 0 skipped, 0 failed**; role and privileges removed afterwards (verified absent).
- `test/tenant-cross-company.e2e-spec.ts` — two new negatives: another company's invitations are never listed (and their email never appears), and revoking one returns 404 with `revoked_at` still null. Tenant-isolation total is now **17 passed, 0 skipped, 0 failed** (14 cross-company + 3 synthetic RLS).

**Global-table count corrected:** [RLS_EXCLUSION_REVIEW.md](RLS_EXCLUSION_REVIEW.md) previously said "Intentionally global (5)" while listing seven tables. It now states 7 objects across 5 classes, consistent with the 11-table enumeration (7 global + 3 control-plane + 1 ledger).

**Not changed:** no RLS policy enabled, no shared-database migration applied, no hosting setting or deployment touched, no branch created.

## Pending-migration reconciliation — 2026-11-21

**Scope:** the five newest migrations, which no shared ledger can contain yet. No migration was applied to the shared development or production database, no hosting or credential setting was touched, and no branch was created.

| Migration | Adds | Data-changing statements |
|---|---|---|
| `202611180001_manufacturing_quality_rebatch.sql` | 4 tables, 5 indexes, 4 RLS policies, grants | none |
| `202611180002_inventory_batch_traceability.sql` | 4 tables, 6 indexes, 3 RLS policies, grants | one idempotent `legacy_snapshot` backfill from `inventory_stock_levels` |
| `202611190001_user_display_preferences.sql` | 1 table, PK + membership FK + format check | none |
| `202611190002_user_display_preferences_rls.sql` | RLS policy, grants | none |
| `202611210001_control_plane_least_privilege.sql` | catalog/ledger grants only | none |

### Defects found and corrected before any application

1. **Rebatch index/status mismatch.** `manufacturing_rebatch_lots_available_idx` was declared `WHERE status = 'released'`, but the table's `CHECK` allows only `available`, `partially_consumed`, `consumed`, `blocked`, `disposed`, and `manufacturing.service.ts:130` reserves lots with `status IN ('available','partially_consumed')`. The predicate therefore matched no row and the index was dead. Corrected to `WHERE status IN ('available','partially_consumed')`, with `DROP INDEX IF EXISTS` first so a stale definition would be replaced rather than kept. The application code, not the index, defined the intended statuses; no status value was invented.
2. **Legacy batch-code collision.** The inventory backfill derived `LEGACY-<first 12 characters of the stock-level UUID>` under a `(company_id, batch_code)` unique constraint. Two stock levels sharing a 12-character prefix aborted the whole migration with `23505` — reproduced in the rehearsal. The code now uses the complete identifier (`LEGACY-<32 hex>`), which is still deterministic and idempotent through the `source_reference` guard.
3. **Missing runtime grant.** `202611190002` enabled RLS on `user_display_preferences` but never granted the runtime role access, so `omega_app_dev` got `permission denied` on the new table. The migration now issues the same conditional `GRANT SELECT, INSERT, UPDATE, DELETE` used by the other pending migrations.

### Rehearsal (`api/scripts/rehearse-pending-migrations.mjs`, wired into `development-validation.yml`)

Rebuilds the development schema **before** the five files (82 migrations), seeds two companies with memberships, products, warehouses, four stock levels (positive, zero, fully reserved, foreign) and a production order, then applies the five with the real runner.

**32/32 checks passed** on disposable PostgreSQL 18.7 (`omega_pending_migrations_test`), exit 0:

- runner applied the five in order: `...180001 → ...180002 → ...190001 → ...190002 → ...210001`;
- corrected index predicate present, planner uses the index, and the status domain rejects the old `released` value with `23514`;
- backfill created exactly 3 snapshots for 3 positive levels, copied quantity/reservation/cost exactly, skipped the zero level, marked the fully reserved level `depleted`, created **0** stock movements, and left aggregates at 20.0000 quantity / 7.0000 reserved;
- re-running the migration set is idempotent (still 3 snapshots, index and policies unchanged);
- uniqueness: batch code per company (`23505`, reusable across companies), `reserved <= on hand` and negative receipts (`23514`), rebatch lot number and one-lot-per-quality-event (`23505`), quantity split `23514`, movement/batch allocation (`23505`), display-preference PK (`23505`), non-member FK (`23503`), invalid format (`23514`);
- RLS: 8 new tables, 8 policies, `omega_app_dev` is `NOBYPASSRLS`/non-superuser, own-company rows visible, spoofed `app.company_id` with a foreign membership returns 0 rows, missing context returns 0 rows, cross-company insert and another user's preference both refused;
- control plane: `permissions`, `role_permissions`, `subscription_plans` readable; 7 write statements (INSERT/UPDATE/DELETE/TRUNCATE) rejected with `42501`; `omega_schema_migrations` unreadable (`42501`); `auth_rate_limits` still writable.

### Full local gates (disposable PostgreSQL 18.7, `development` tree)

| Gate | Command | Result |
|---|---|---|
| Clean install + idempotency | `npm run migrate` twice on a rebuilt `omega_ci_test` | 87 migrations applied, second run all `already applied`; 121 tables, 110 with RLS, 110 policies, **11 without RLS** |
| Unit | `npm test` | **587 passed, 0 skipped, 0 failed** |
| Tenant isolation + control plane | `test/tenant-cross-company`, `test/tenant-rls`, `test/control-plane-least-privilege` | **23 passed, 0 skipped, 0 failed** (17 isolation + 6 control plane) |
| Application RLS | `test/application-rls` on dedicated empty DB | **4 passed, 0 skipped, 0 failed** |
| Forward-repair rehearsal | `rehearse-schema-forward-repair.mjs` | 6/6 |
| Cost-repair rehearsal | `rehearse-inventory-cost-repair.mjs` | 6/6 |
| Lint / build (API) | `npm run lint`, `npm run build` | 0 warnings / 0 errors (258 files); build ok |
| Lint / build (frontend) | `vite-version` `npm run lint`, `npm run build` | both ok |

No security test was skipped. The read-only inspector still reports `rolbypassrls=true` for the local superuser fixture and exit 2 — that is the designed P0 for that identity, not a schema finding.

### Review against the actual development schema — blocked, not assumed

This workspace has **no shared-database credential** (`DATABASE_URL`, `NEON_*`, `VERCEL_*` unset; `gh` unauthenticated), so the five files could not be compared with the live development catalog. What is established instead:

- every object they reference (`manufacturing_production_orders`, `products(id,company_id)`, `warehouses(id,company_id)`, `inventory_stock_levels.average_unit_cost` + `reserved_quantity`, `sales_order_reservations`, `inventory_stock_movements`, `company_memberships(user_id, company_id)` unique, `permissions`, `role_permissions`, `subscription_plans`, `auth_rate_limits`, `omega_schema_migrations`) is documented present in the 2026-10-29 read-only inspection and is created by migrations that precede the five in the current tree;
- `user-preferences.service.ts` requires `user.companyId` and runs through `tenantDatabaseContext`, so the display-preference policy is compatible with the endpoint that uses it;
- no file references an object from the still-missing tax-snapshot / credit-note-link / supplier-uniqueness set, so the five are independent of those repairs.

**Blocker:** confirming the live development catalog still matches this assumption needs the read-only owner-run `inspect-database-readonly.mjs` output (or a read-only connection string). Until then the five are rehearsed, not verified against shared.

### Remaining blockers (unchanged by this work)

1. Shared development ledger/schema: still unreconciled (48 rows for 66 files at inspection; 87 files today). Applying these five to shared requires the approved repair window — they cannot be applied while the runner's gap guard is tripped.
2. Runtime role: `omega_app_dev`/`omega_app` must be non-owner with `NOBYPASSRLS` for the grants to bind; unverified in hosting.
3. Branch protection on `development` is still `protected: false`.
4. The shared tax-snapshot, credit-note-link and supplier-uniqueness repairs remain rehearsed-only.

**CI:** `Development validation` run [44908951645](https://github.com/fielddataresearch83-cpu/Omega-Solutions-ERP/actions/runs/44908951645) on `development` `9086c876` — the single `validate` job concluded **success** (job-level; GitHub's public run page does not expose step names, so this confirms the job, not each step).

## CI evidence — 2026-11-21

- **`Development validation` run [44898232714](https://github.com/fielddataresearch83-cpu/Omega-Solutions-ERP/actions/runs/44898232714) — success** on `development` `9f14c1db`. Step conclusions: `Apply migrations to disposable CI database` success, `Rehearse schema forward-repair bundle in isolation` success, `Rehearse inventory weighted-average cost correction in isolation` success, `Verify tenant isolation and role boundaries` success, `Verify company RLS policy migration` success. Both RLS steps carry a JSON assertion that fails the job if any test skips or if the executed count is below the expected minimum, so "success" means the suites executed.
- **Run [44896491717](https://github.com/fielddataresearch83-cpu/Omega-Solutions-ERP/actions/runs/44896491717) — failure diagnosed, not guessed.** `Test API` succeeded, `Apply migrations to disposable CI database` failed, every later step was skipped. Root cause reproduced locally: the MFA concurrency spec created `users`/`user_mfa` in `omega_ci_test`, so the migration runner refused to start (tables exist without a ledger). Fixed by giving MFA its own disposable database (`omega_mfa_test`).
- No `Development validation` run exists for `f9ef9102`: it was superseded within seconds by the next push and cancelled by the workflow's `cancel-in-progress` concurrency group. Its change is contained in the verified `9f14c1db` tree.
- **`development` branch protection re-checked 2026-11-21: `protected: false`** (GitHub branches API). Required checks are still not enforced; this needs repository administration, not a code change.
- Added a cross-tenant membership negative: a company owner cannot suspend or change the role of another company's membership (404, target verified unchanged). `company_memberships` is outside RLS, so this is application-layer evidence for that control-plane table.

## Current checkpoint

- [x] Confirm current repository and branch. Evidence (2026-11-15): `origin` is `fielddataresearch83-cpu/Omega-Solutions-ERP`; branch is `development`; workspace HEAD is `c302e6f29dc2c23cd5e81277d8ff3c579a0ebfc3`. Existing uncommitted changes were preserved. This HEAD has not been pushed or CI-verified.
- [ ] Verify applicable GitHub Actions workflows on the exact current release-candidate commit. No new workflow run was triggered in this session; historical run references from the former `Omega-Solutions-Local-Development` repository are not evidence for this repository.
- [ ] Establish and verify a local pre-push validation gate in the user's working copy. Do not push further code until local API build/tests/lint, frontend build/lint as applicable, and disposable PostgreSQL integration/migration checks have been run successfully. A GitHub-hosted CI result cannot retroactively serve as a pre-push gate.
- [ ] Resolve overlapping CI workflows and Node-version inconsistency. Current workflow inventory shows `development-validation.yml` uses Node 24, `validate-development.yml` uses Node 24, and `workforce-validation.yml` uses Node 22, while the repository `.nvmrc` specifies Node 22.22.3. Confirm package engine compatibility, then consolidate or clearly partition checks; do not change workflows until the proposed configuration is validated locally.
- [ ] Make CI a reliable release gate: ensure required checks are configured/enforced on the existing `development` branch. Branch protection was previously observed disabled; recheck through an authorized owner/admin route. Do not claim required checks are enforced.
- [ ] Complete route-to-service authorization inventory and isolated negative tests.
- [ ] Confirm the runtime PostgreSQL role without exposing credentials; do not alter hosting. The 2026-10-29 read-only Neon catalog inspection found 55 public tables with RLS enabled but zero policies; the inspected owner role bypassed RLS. The 2026-11-21 source rebuild finds 110 policies in the current migration tree, so the older zero-policy snapshot is stale rather than current; the runtime role is still unverified.
- [ ] Design and test a least-privilege tenant-isolation approach on an isolated/disposable database before any shared-database changes.
- [ ] Reconcile the shared development database migration ledger/schema safely using an isolated schema clone; do not run catch-up migrations or mutate shared Neon as part of this audit.

**Last completed task (2026-11-15):** Consolidated API workflow review across sales, procurement, inventory/POS, accounting, payroll, manufacturing and projects; added company-switch authorization regression tests and an application RLS test wired into development CI; implemented company-timezone-aware business dates for POS, payroll, accounting and workforce. API unit suite: 557 passed, 2 PostgreSQL-dependent tests skipped; API lint/build passed. No production, shared Neon, Vercel or business data was changed.

**Next task (updated 2026-11-17):** Safely publish the two validated local commits plus the uncommitted timezone DTO validation to the existing `development` branch only, after confirming Vercel Production protection and GitHub remote head. Then require the PostgreSQL RLS CI job to execute and pass (not skip). Follow with isolated PostgreSQL API E2E workflows for sales-to-cash, procure-to-pay, POS stock/accounting, payroll posting/remittance and manufacturing. Preserve all existing working-tree changes; do not force-push, create branches, deploy to Production or touch shared/production databases.

**Current branch:** `development` (existing branch only). No new branches.

**Production status:** NOT APPROVED; P0 tenant-isolation and governance blockers remain.

## Latest workflow audit — 2026-11-15

**Scope reviewed:** quotations and sales orders; invoices, receipts, credit notes and M-Pesa; customers and products; inventory and POS; requisitions, approvals, purchase orders, goods receipts, suppliers and supplier bills; accounting; payroll/remittances; employees, expenses and workforce; manufacturing; projects and reminders; subscriptions and Paystack. This is an API/code and automated-test review, not an end-to-end acceptance sign-off.

**Validation evidence from the current uncommitted workspace:**

- API unit suite: `npm test` — **554 passed, 2 skipped** (68 test files passed, 1 skipped). The two skipped tests require PostgreSQL.
- API lint: `npm run lint` — 0 warnings, 0 errors. API build: `npm run build` — passed.
- Frontend lint: `npm run lint` — passed. Frontend build: `npm run build` — passed (TypeScript and Vite production build).
- PostgreSQL RLS E2E command without `DATABASE_URL`: 7 tests skipped as designed. No local PostgreSQL service was available, so neither the synthetic nor application-migration SQL behavior is claimed as executed.
- Added `api/test/application-rls.e2e-spec.ts`, which runs the actual `202611120004_company_rls_policies.sql` source against a clean local `omega_ci_test` database and exercises company, branch, missing-context, inactive-membership, cross-company insert and update cases. The test refuses non-local database hosts and refuses to run if `public.company_memberships` already exists. `.github/workflows/development-validation.yml` now runs it alongside the synthetic RLS test. CI has not yet run this uncommitted change.
- `api/test/app.e2e-spec.ts` currently verifies only `GET /api` returns the root response; it is not a business-workflow E2E suite.

**Workflow review observations:**

- Core state-changing paths use database transactions in sales, invoice/payment, credit-note, procurement/receiving, supplier-bill, POS, accounting, payroll, manufacturing, projects and approvals services. Unit tests cover many calculation and transition rules, but they do not prove the complete cross-module workflows or concurrent PostgreSQL behavior.
- The current unit-test coverage is uneven: quotations 2 tests; customers 3; suppliers 3; invoice-related tests 4; purchase orders 11; supplier bills 10; inventory 47; POS 20; accounting 52; payroll 48; manufacturing 17; projects 10; approvals 16; workforce 19. Counts are test cases found in current specs, not coverage percentages.
- Business controllers generally apply JWT, permission and (where applicable) module-entitlement guards. Dashboard uses JWT plus per-module permission checks in its service; notifications use JWT and user/tenant-scoped operations. The M-Pesa callback is intentionally public but correlates by checkout request ID and checks callback amount and phone before processing; Paystack webhook uses HMAC-SHA512 signature validation and server-side transaction verification. These code checks are not a substitute for negative integration tests.
- Company timezone is persisted (default `Africa/Nairobi`) and is now included in active membership context. A shared `businessDateAt` helper drives POS checkout dates, payroll effective dates and employee pay-setting cut-offs, accounting trial-balance/reconciliation/ageing/reversal dates, and workforce assignment checks at punch time. Unit tests cover Nairobi and a timezone west of UTC. Historical month-end/date arithmetic remains UTC by design. PostgreSQL-backed workflow validation is still pending; see FIND-25.

**Do not check off module acceptance items yet.** Full workflow E2E, database-backed RLS execution and browser journey tests remain outstanding. The company-timezone correction is implemented and unit-tested, but awaits CI/integration verification. Production remains **NOT APPROVED**.

## Status legend

- **P0** — release blocker: security, tenant isolation, financial integrity, deployment safety, data loss.
- **P1** — required for a dependable commercial launch.
- **P2** — improvement or lower-risk follow-up.
- **Verified** — acceptance criteria passed with recorded evidence.
- **Partial** — some evidence exists; at least one acceptance criterion remains.
- **Unverified** — must inspect/test.
- **Blocked** — cannot safely proceed; record the dependency.

---

## 1. Release controls and repository governance — P0

- [x] **RC-01** Confirm current `development` HEAD and ensure all work targets this existing branch only. Evidence: GitHub branch API checked 2026-10-29; current source HEAD at review time `3ff399e72abf58468c41dd82945b59ce19c1da34`; all audit work targets the existing `development` branch.
- [x] **RC-02** Inventory every GitHub Actions workflow, reusable workflow, deployment script, package script, and hosting integration. Evidence: enumerated all 14 `.github/workflows/*.yml` files, root/API/Vite/Next.js package scripts, `vite-version/vercel.json`, and deployment guidance/config references in `docs/`; no root `render.yaml`, `Dockerfile`, `netlify.toml`, or `railway.json` appeared in the recursive repository tree.
- [x] **RC-03** For every workflow, document trigger, permissions, secrets, target environment, and whether it can deploy or mutate data. Evidence: all 14 workflow YAML files reviewed for triggers, permissions, referenced credentials, target environments, and side effects. No live workflow was triggered.
- [x] **RC-04** Remove the unrelated ShadcnStore deployment workflow from Omega's `development` branch. Evidence: deleted `.github/workflows/deploy.yml` in commit `16a75bbfcc65b383f3bc16fe1a7ebc0f70c1c9c7`; this removes the workflow definition from this repo and does not alter the remote ShadcnStore server.
- [ ] **RC-05** Review branch protection/rulesets and required checks. Rechecked 2026-10-29: `development` remains `protected: false`, with no required status checks. The connected GitHub integration cannot read the branch-protection endpoint (403); repository rulesets are unavailable on the current private-repository plan (403). This remains an open governance blocker; configure required CI checks in GitHub repository settings when the owner/admin UI or a suitably authorized connection is available. Do not claim protection is enabled.
- [ ] **RC-06** Confirm CI runs on relevant pushes and that failed checks block release through a documented process.
- [ ] **RC-07** Replace template-like root documentation with accurate setup, architecture, test, deployment, and recovery guidance.
- [ ] **RC-08** Confirm dependency lockfiles, supported Node/runtime versions, license notices, and no accidental generated artifacts.
- [ ] **RC-09** Scan repository history and tracked files for committed secrets; rotate any exposed credentials through the provider if found.
- [ ] **RC-10** Verify frontend and API deployment projects, root directories, build commands, environment scopes, domains, and deployment targets without deploying. Partial evidence (2026-10-29): Render metadata confirms `omega-solutions-api-development` points at the existing `development` branch, auto-deploy is off, root directory is repository root, build `npm ci && npm run build`, start `npm run start:prod`, free plan, and healthCheckPath is unset. Runtime DB role and full env scopes still unverified.
- [ ] **RC-11** Verify the release process requires explicit human approval and never deploys production automatically from this audit.

**Acceptance:** All workflows and targets are known; no accidental production path; required CI and review gates are documented and enforced.

## 2. Tenant isolation, authorization, and data access — P0

- [ ] **SEC-01** Inventory every API controller/route and map it to authentication, company scope, branch scope, role/permission, module entitlement, and subscription-plan enforcement. Partial controller pass (2026-10-29): reviewed guards/decorators for accounting, approvals, audit, branches, companies, contracts, credit notes, CRM, customers, dashboard, employees, expenses, inventory, invoices/M-Pesa, manufacturing, notifications, payroll/remittances, POS, products, purchase orders, quotations, requisitions, sales orders, search, subscriptions, supplier bills, suppliers, users/roles, workforce, and auth. Most business controllers use JWT + permission + module guards; intentionally scoped exceptions (dashboard/search/notifications/subscriptions) need service-level verification. Audit log reads now enforce branch scope for branch-bound callers (FIND-20). Expanded the read-only live tenant smoke to compare list IDs across 20 resource groups and probe direct record access where a detail route exists; [run 40895642436 passed](https://github.com/pestria72-code/Omega-Solutions/actions/runs/40895642436). This is partial live coverage, not a complete route-to-service matrix.
- [ ] **SEC-02** Trace company context from verified identity/session through every service and database query; reject client-supplied tenant IDs unless independently authorized.
- [ ] **SEC-03** Verify active membership and company switching; inactive/revoked memberships must be rejected immediately.
- [ ] **SEC-04** Review PostgreSQL roles, grants, ownership, connection pooling, and all RLS-enabled tables; verify actual policies and runtime role behavior rather than assuming RLS is present or absent.
- [ ] **SEC-05** Test cross-company access for list, read, create, update, delete, search, exports, reports, attachments, images, imports, notifications, and background jobs. The expanded read-only live smoke checks list-ID overlap and direct foreign-record reads for 20 resource groups where routes exist; [run 40895642436 passed](https://github.com/pestria72-code/Omega-Solutions/actions/runs/40895642436). Mutating cases, file/object storage, exports, async jobs, and every branch/role combination remain unverified.
- [ ] **SEC-06** Test branch restrictions for stock, POS, sales, staff, reports, and all branch-aware endpoints.
- [ ] **SEC-07** Test role boundaries for owner, administrator, finance, procurement, HR, manager, and salesperson; verify enforcement in API/service, not only UI.
- [ ] **SEC-08** Verify subscription status and module entitlements are enforced server-side on every protected route and background job.
- [ ] **SEC-09** Review IDOR/BOLA, mass assignment, unsafe object binding, pagination/filter injection, SQL injection, and insecure direct file access.
- [ ] **SEC-10** Verify audit logs for sensitive actions are tenant-scoped, tamper-resistant enough for the threat model, and do not record secrets.
- [ ] **SEC-11** Run automated tenant-regression tests against isolated fixtures; record positive and negative cases.
- [ ] **SEC-12** Verify uploaded files/product images are tenant-isolated, validated, size-limited, and inaccessible by guessing storage keys.
- [ ] **SEC-13** Verify rate limits and abuse protections on login, verification, invitations, password reset, exports, and expensive endpoints. Database-backed per-IP throttles for MFA enroll (5/minute), confirm (10/minute), and disable (5/minute) now pass CI under FIND-23. Continue coverage for verification, invitation, password reset, exports, and expensive endpoints.

**Acceptance:** No cross-company or unauthorized branch/role/plan access in API, files, reports, exports, or async work. Any P0/P1 authorization defect blocks release.

## 3. Authentication, sessions, invitations, and account lifecycle — P0

- [ ] **AUTH-01** Trace registration, email verification, login, multi-company selection, session exchange, refresh, logout, and revocation end to end.
- [ ] **AUTH-02** Verify access tokens remain in memory and refresh tokens use secure HttpOnly cookies; no legacy token persistence remains.
- [ ] **AUTH-03** Verify cookie Secure/SameSite/Path/Domain settings, CORS allowlist, CSRF posture, HTTPS, and proxy configuration.
- [ ] **AUTH-04** Verify refresh rotation, reuse detection, session-family revocation, expiry, logout-all, and concurrent refresh behavior.
- [ ] **AUTH-05** Verify password reset and email verification are single-use, time-limited, rate-limited, and do not reveal whether an email exists.
- [ ] **AUTH-06** Verify invitation is tenant-scoped, email-matched, single-use, expiring, revocable, and cannot activate an unintended company/role/branch.
- [ ] **AUTH-07** Verify invitation acceptance and company selection cannot be bypassed by calling APIs directly.
- [ ] **AUTH-08** Verify role, membership, branch, or company deactivation changes invalidate/restrict existing sessions as required.
- [ ] **AUTH-09** Verify MFA enrollment, challenge, recovery, and enforcement for privileged accounts where supported.
- [ ] **AUTH-10** Verify login/invite/verification abuse controls, account lockout or throttling, and security event logging.
- [ ] **AUTH-11** Verify errors do not leak tokens, password hashes, PII, or sensitive internal details.
- [ ] **AUTH-12** Test account deletion/deactivation, data retention, and ownership-transfer rules.

**Acceptance:** All identity and account lifecycle paths pass browser + API tests, including abuse and revocation cases.

## 4. Database schema, migrations, and data integrity — P0

- [ ] **DB-01** Inventory migration files and determine the authoritative migration ordering, checksums, and duplicate/legacy numbering. Version-aware ordering is now explicit and tested. The duplicate `024_*` workforce migrations remain in place for checksum safety, but the foundation migration is ordered first and CI asserts the resulting schema.
- [ ] **DB-02** Verify a clean database can be built from migrations alone in the intended order. A disposable PostgreSQL 16 CI job now runs the full migration runner on a fresh database and reruns it to verify idempotency. First run failed at `013_inventory_warehousing.sql` because timestamped `20261014190000_010_quotations.sql` was sorted after migration 013; `api/scripts/migration-order.mjs` now orders embedded legacy versions 010/011 before later numbered migrations and normalizes timestamp-only names. Explicit comparator assertions and clean-install rerun are pending CI.
- [ ] **DB-03** Verify an existing database upgrades safely from its current schema without destructive reset or undocumented manual steps.
- [ ] **DB-04** Check constraints, foreign keys, unique constraints, indexes, nullability, numeric precision, timezone handling, and cascade behavior.
- [ ] **DB-05** Review transaction boundaries and isolation for concurrent stock, invoice, payment, payroll, contract, and subscription operations.
- [ ] **DB-06** Confirm all monetary fields use appropriate exact numeric types and rounding rules.
- [ ] **DB-07** Verify database connections use least privilege, TLS where required, bounded pool sizes, and safe error handling.
- [ ] **DB-08** Verify no business-data reset/seed script runs automatically outside isolated test environments.
- [ ] **DB-09** Document schema backup/restore and migration rollback/forward-repair strategy.
- [ ] **DB-10** Verify migration failure leaves a detectable, recoverable state and does not partially expose incompatible app versions.

**Acceptance:** Clean install and upgrade tests pass on disposable databases; no shared development or production data reset is required.

## 5. Inventory, warehouse, stock movements, and POS — P0

- [ ] **INV-01** Map product, category, unit, warehouse, branch, supplier, stock balance, movement, adjustment, transfer, and valuation models/APIs/UI.
- [ ] **INV-02** Verify stock movements are ledger-backed, traceable, and cannot be silently overwritten to fake balances.
- [ ] **INV-03** Test concurrent sales, receiving, adjustments, transfers, returns, and cancellations for overselling/lost updates.
- [ ] **INV-04** Verify warehouse/branch assignment and salesperson stock issuance restrictions.
- [ ] **INV-05** Verify negative-stock policy is explicit and enforced consistently.
- [ ] **INV-06** Verify stock valuation/costing method and accounting integration are consistent.
- [ ] **INV-07** Verify product image upload/preview/replace/remove and tenant isolation.
- [ ] **INV-08** Verify barcode/SKU uniqueness, units/conversions, batch/serial/expiry handling if offered, and import validation.
- [ ] **POS-01** Verify till/session opening and closing, cash/card/M-Pesa methods, receipts, refunds, voids, and cashier accountability.
- [ ] **POS-02** Verify offline/network retry behavior cannot duplicate sales or payments.
- [ ] **POS-03** Verify price override, discounts, below-standard-price restrictions, tax, and permission checks server-side.
- [ ] **POS-04** Verify stock and accounting effects are atomic or safely recoverable on partial failure.

**Acceptance:** Inventory and POS have repeatable end-to-end tests with traceable stock and accounting outcomes.

## 6. Sales, customers, invoices, payments, refunds, and credit notes — P0

- [ ] **SAL-01** Verify customer lifecycle and company/branch ownership.
- [ ] **SAL-02** Verify quotations/orders/delivery/invoice lifecycle and permitted status transitions.
- [ ] **SAL-03** Verify invoice numbering is unique, concurrency-safe, tenant-scoped, and never reused improperly.
- [ ] **SAL-04** Verify tax classification and company-configured standard rate on product create/update and invoice calculation.
- [ ] **SAL-05** Verify credit notes derive tax and line limits from the original invoice and prevent over-crediting under concurrency.
- [ ] **SAL-06** Verify payment records, allocations, partial payments, overpayments, reversals, and reconciliation.
- [ ] **SAL-07** Verify payment callbacks/webhooks are authenticated, idempotent, and replay-safe.
- [ ] **SAL-08** Verify invoice/receipt PDFs and exports agree with canonical server values and are tenant-scoped.
- [ ] **SAL-09** Verify invoice posting, cancellation, refunds, and credit notes create balanced/reversible accounting entries.
- [ ] **SAL-10** Verify duplicate submission, timeout, retry, and double-click behavior.
- [ ] **SAL-11** Verify customer/supplier balances and dashboard/report totals against source records.

**Acceptance:** No duplicate financial effects, unauthorized edits, tax inconsistencies, or unbalanced postings.

## 7. Finance and accounting — P0

- [ ] **ACC-01** Inventory chart of accounts, financial years, periods, journals, general ledger, trial balance, P&L, balance sheet, cash flow, bank reconciliation, and audit trail.
- [ ] **ACC-02** Verify journals are balanced server-side and cannot be edited after posting except through controlled reversals.
- [ ] **ACC-03** Verify sequence generation, period locking, closed-period restrictions, and concurrent posting.
- [ ] **ACC-04** Verify every supported business transaction maps to the correct accounts and tax treatment.
- [ ] **ACC-05** Reconcile AR/AP, inventory valuation, bank/cash, payroll liabilities, tax liabilities, and control accounts to their ledgers.
- [ ] **ACC-06** Verify opening balances and financial-year rollover.
- [ ] **ACC-07** Verify report calculations, filters, pagination, and tenant/branch access.
- [ ] **ACC-08** Verify accounting corrections use audit-traceable reversal/adjustment rather than destructive edits.
- [ ] **ACC-09** Verify rounding, currency, exchange-rate, and decimal precision behavior for supported use cases.
- [ ] **ACC-10** Independently test report totals against hand-calculated fixtures.

**Acceptance:** All core financial statements reconcile to the ledger; every posting is balanced, traceable, and safely reversible.

## 8. Procurement, requisitions, approvals, supplier bills, and contracts — P0/P1

- [ ] **PROC-01** Verify supplier records and supplier access are company-scoped.
- [ ] **PROC-02** Verify requisition → approval → purchase order → receipt → supplier bill → payment lifecycle.
- [ ] **PROC-03** Verify approval thresholds, separation of duties, delegation, rejection, resubmission, and audit logs.
- [ ] **PROC-04** Verify receiving updates stock exactly once and reconciles to purchase order and supplier bill.
- [ ] **PROC-05** Verify supplier invoice duplicates, quantity/price discrepancies, tax, and partial deliveries.
- [ ] **CON-01** Verify contracts link to requisitions/orders and related supplier, branch, budget, and stock records as designed.
- [ ] **CON-02** Review contract status transitions for concurrency races; status validation and update must be atomic/transaction-safe.
- [ ] **CON-03** Verify contract amendments, renewal/expiry, cancellation, attachments, approvals, and audit history.
- [ ] **CON-04** Verify contract/requisition authorization and company isolation on all reads/writes/exports.
- [ ] **CON-05** Verify obligations, reminders, and contract documents are handled without leaking across tenants.

**Acceptance:** Procurement and contract lifecycles are consistent, approval-controlled, and race-safe.

## 9. Subscriptions, plans, checkout, and payment provider — P0/P1

- [ ] **BILL-01** Verify plan limits and module entitlements are enforced by backend services, not only navigation/UI.
- [ ] **BILL-02** Verify subscription activation, renewal, grace period, cancellation, expiry, and downgrade behavior.
- [ ] **BILL-03** Diagnose Paystack checkout 503 (“Paystack test mode is not configured”) by tracing runtime config loading, environment scope, and mode without printing secrets or asking the user to re-confirm already reported variables.
- [ ] **BILL-04** Verify provider webhooks, signature validation, idempotency, amount/currency matching, and replay resistance.
- [ ] **BILL-05** Verify failed, abandoned, duplicate, delayed, and refunded payments do not grant incorrect entitlements.
- [ ] **BILL-06** Verify subscription invoices, receipts, tax, and reconciliation.
- [ ] **BILL-07** Verify no test-mode credentials or provider configuration can silently activate production billing.
- [ ] **BILL-08** Verify customer self-service and platform-owner controls, including audit trails.

**Acceptance:** Payment status and entitlements remain correct under retries, webhook delays, failures, and cancellations.

## 10. HR, payroll, statutory deductions, attendance — P0/P1

- [ ] **HR-01** Verify employee, employment, compensation, bank/payment details, documents, and HR permissions.
- [ ] **HR-02** Verify payroll calculation is versioned, reproducible, reviewable, and locked after approval.
- [ ] **HR-03** Verify Kenya PAYE, NSSF, SHA, applicable NHIF legacy handling, Housing Levy configuration, KRA PIN/ID fields, and effective dates against authoritative current rules.
- [ ] **HR-04** Verify company-specific statutory choices are explicit rather than silently hard-coded.
- [ ] **HR-05** Verify NSSF caps/bands and custom modes are applied only to their intended statutory periods/configurations.
- [ ] **HR-06** Verify payroll totals, deductions, net pay, journals, statutory liabilities, and payslips reconcile.
- [ ] **HR-07** Verify payroll approval, segregation of duties, access logs, and prevention of unauthorized reruns/duplicate payment.
- [ ] **HR-08** Verify attendance and leave calculations, corrections, and branch/timezone rules.
- [ ] **HR-09** Verify sensitive employee data is masked and restricted by role.
- [ ] **HR-10** Keep payroll wallet/transfers disabled until licensing, compliance, reconciliation, and security requirements are explicitly cleared.

**Acceptance:** Payroll is independently recalculated and reconciled for supported periods; no unapproved payment execution.

## 11. CRM, manufacturing, project management, and remaining modules — P1

For each module, complete the same evidence chain: **route/page → API/controller → service → schema/migration → authorization → tests → end-to-end workflow**.

- [ ] **MOD-01 CRM:** leads, contacts, activities, pipeline, follow-ups, conversion, ownership, reporting.
- [ ] **MOD-02 Manufacturing:** bills of materials, work orders, material consumption, finished goods, costing, waste, and stock/accounting effects.
- [ ] **MOD-03 Project management:** verify whether this is a real backend-backed module or a template/static task page; map projects, tasks, milestones, assignment, time, costs, contracts, procurement, inventory, and billing integrations.
- [ ] **MOD-04 Workforce/HR:** roles, leave, attendance, timesheets, approvals, employee lifecycle.
- [ ] **MOD-05 Reports/analytics:** server-calculated totals, permission-aware filters, exports, performance, and tenant isolation.
- [ ] **MOD-06 Notifications:** tenant-scoped delivery, retries, preferences, and no secret/PII leakage.
- [ ] **MOD-07 Imports/exports:** validation, safe retries, row-level error reporting, authorization, and limits.
- [ ] **MOD-08 Every sidebar item:** confirm route resolves, page name is correct, actions are real, empty/error/loading states exist, and the UI calls the intended API.
- [ ] **MOD-09 Every advertised feature:** classify as verified, partial, missing, or intentionally unavailable; remove misleading UI claims.
- [ ] **MOD-10 Module dependency rules:** verify enabling/disabling a module leaves navigation, APIs, subscriptions, and related data behavior consistent.

**Acceptance:** No important navigation dead ends, template placeholders presented as working features, or modules that bypass backend permissions.

## 12. Frontend, UX, search, and performance — P1

- [ ] **UI-01** Confirm which frontend is authoritative for deployment (`vite-version/` vs `nextjs-version/`) by inspecting hosting config and actual build path.
- [ ] **UI-02** Inventory routes, page titles, sidebar links, breadcrumbs, buttons, forms, modals, and route guards.
- [ ] **UI-03** Verify global search and page-level search use correct tenant-scoped APIs, debounce appropriately, handle empty/error states, and return useful results.
- [ ] **UI-04** Remove mock/static business metrics and template placeholders from operational screens.
- [ ] **UI-05** Fix broken links, incorrect page names, layout/alignment defects, responsive behavior, and keyboard/accessibility issues.
- [ ] **UI-06** Verify loading, empty, permission-denied, validation, offline, and API-error states.
- [ ] **UI-07** Replace downloading full entity lists for dashboard summaries with authorized server-side aggregate endpoints where needed.
- [ ] **UI-08** Test slow API, retry, duplicate clicks, stale data, and expired session handling.
- [ ] **UI-09** Verify forms provide server validation errors and do not rely solely on client-side validation.
- [ ] **UI-10** Browser-test all critical workflows against the development environment and isolated test data.

**Acceptance:** All critical user journeys are coherent, accessible, responsive, and backed by real authorized data.

## 13. Onboarding and first-run setup — P1

- [ ] **ONB-01** Verify a new owner can register, verify email, create/select a company, and reach the correct tenant context.
- [ ] **ONB-02** Verify a first-run setup wizard configures company details, currency, timezone, financial year, tax, chart of accounts, branches, warehouses, and opening balances as applicable.
- [ ] **ONB-03** Verify onboarding does not seed demo/sample businesses, products, invoices, staff, or financial transactions.
- [ ] **ONB-04** Verify invitations, role assignment, branch assignment, and first staff sign-in.
- [ ] **ONB-05** Verify plan selection and checkout errors are clear and do not grant entitlements prematurely.
- [ ] **ONB-06** Verify incomplete onboarding is resumable and setup can be safely corrected with audit trails.
- [ ] **ONB-07** Verify a company cannot transact before required accounting/tax choices are configured.

**Acceptance:** A real business can configure its own tenant without demo data, support intervention, or unsafe defaults.

## 14. Reliability, backups, monitoring, and recovery — P0/P1

- [ ] **OPS-01** Document production and development topology, owners, dependencies, environment separation, and failure modes.
- [ ] **OPS-02** Verify automated database backups, retention, access controls, and recovery point objective.
- [ ] **OPS-03** Perform a restore drill to an isolated target and verify application-level consistency.
- [ ] **OPS-04** Configure health/readiness checks and alerts for API failures, database connectivity, payment webhook failures, and background jobs.
- [ ] **OPS-05** Verify structured logs, correlation/request IDs, useful error tracking, and PII/secret redaction.
- [ ] **OPS-06** Test startup, database unavailable, provider unavailable, rate limiting, timeout, and recovery behavior.
- [ ] **OPS-07** Verify database pool sizing, timeouts, retries, graceful shutdown, and Render cold-start implications.
- [ ] **OPS-08** Load-test key workflows and identify slow queries, unbounded lists, missing indexes, and memory bottlenecks.
- [ ] **OPS-09** Document incident response, credential rotation, rollback/forward-fix, and customer communications.
- [ ] **OPS-10** Verify storage backup/retention and restore for uploaded files as well as database metadata.

**Acceptance:** A tested recovery path exists; failures are observable and recover without silent data corruption.

## 15. Privacy, legal, and commercial operations — P1

- [ ] **LEG-01** Map personal data processed by each module, purpose, access, storage location, retention, and deletion/export path.
- [ ] **LEG-02** Assess applicable Kenya Data Protection Act and ODPC registration/compliance requirements with qualified advice.
- [ ] **LEG-03** Publish accurate privacy notice, terms, subscription terms, acceptable-use terms, and support/contact process.
- [ ] **LEG-04** Verify data-subject access/correction/deletion requests and retention exceptions.
- [ ] **LEG-05** Review processor/subprocessor agreements, cross-border transfers, backups, and incident/breach handling.
- [ ] **LEG-06** Verify customer support/admin access is least-privilege, logged, and tenant-authorized.
- [ ] **LEG-07** Define commercial support, billing disputes, cancellation, refunds, and service availability expectations.
- [ ] **LEG-08** Verify licensing and notices for dependencies, templates, fonts, and assets.

**Acceptance:** Legal/compliance obligations are assessed and operational policies match actual product behavior.

## 16. Automated test strategy and evidence — P0

- [ ] **TEST-01** Record canonical install, lint, typecheck, unit-test, integration-test, build, and CI commands.
- [ ] **TEST-02** Run baseline tests and record failures before fixes; do not mask failures to make CI green.
- [ ] **TEST-03** Add unit tests for calculations, state transitions, validation, and permissions.
- [ ] **TEST-04** Add PostgreSQL integration tests for transactions, constraints, migrations, and concurrency.
- [ ] **TEST-05** Add tenant/branch/role/plan negative tests for every sensitive module.
- [ ] **TEST-06** Add API integration tests for critical business workflows and idempotency.
- [ ] **TEST-07** Add browser E2E tests for onboarding, company switch, invitation, inventory, POS, sales, procurement, accounting, payroll, and subscription flows.
- [ ] **TEST-08** Ensure test data is isolated, explicitly seeded only in test DBs, and cleaned up safely.
- [ ] **TEST-09** Add regression tests for each fixed bug and link the test to the finding ID.
- [ ] **TEST-10** Run relevant CI after every coherent fix and all required checks before release.
- [ ] **TEST-11** Run dependency/security scans and document accepted risks.
- [ ] **TEST-12** Verify tests cannot accidentally point at production or shared business data.

**Acceptance:** Critical paths and security boundaries are automated and repeatable, with no dangerous dependence on production data.

---

## 17. Open findings / known follow-ups

Do not mark these as fixed without fresh inspection and test evidence.

| ID | Priority | Finding / lead | Required next action | Status |
|---|---|---|---|---|
| FIND-01 | P0 | GitHub branch API rechecked 2026-10-29: `development` is currently unprotected; required status checks are off/empty | Enable safe branch protection/ruleset and required CI checks if available; verify settings afterward | Open |
| FIND-02 | P0 | `.github/workflows/deploy.yml` was an unrelated manual production deploy to `shadcnstore.com` via SSH and destructive sync | Removed `.github/workflows/deploy.yml` from Omega `development` in commit `16a75bbfcc65b383f3bc16fe1a7ebc0f70c1c9c7`; remote server and its files were not changed | Confirmed / Resolved in repository |
| FIND-03 | P0 | Cross-tenant isolation must be proven across every route and async/file/report path | Initial read-only spot-check on `development` HEAD `2fea9b3`: company reads use membership checks; branch services check company membership and branch-bound membership; audit-log and notification queries scope by company and, where applicable, user; CRM, expenses, employees, approvals, and other reviewed controllers apply JWT/RBAC guards (some also module-entitlement guards). Additional spot-check: global search returns no results without a company context and scopes customer/product/supplier/invoice searches by `company_id`; employee results also apply the user's branch filter. Payroll and manufacturing controllers use JWT, RBAC, and module-entitlement guards. Product-image upload/remove resolves the selected-company membership, verifies product ownership by `(id, company_id)`, validates image signatures and size, uses tenant-prefixed storage keys, and returns short-lived signed read URLs; focused tests cover foreign-company image upload denial and replacement/removal. Invoice and purchase-order notification triggers select only active memberships and active users in `NEW.company_id`, while notification reads/updates are scoped by company and recipient. Critical live development DB check on Neon project `ancient-lake-38155666`, branch `omega-migration-smoke-test-live` (`br-snowy-block-b4pwz78t`), database `neondb`: read-only `pg_policies` query returned zero policies in `public`; 55 tables have RLS enabled, but none has a policy. The inspected SQL session is `neondb_owner`, whose `pg_roles.rolbypassrls` is true; that role owns `notifications` and `notification_preferences`. The Neon API lists `neondb_owner` as the only user-managed PostgreSQL role for this branch. This proves RLS is not providing a policy-based isolation boundary for the inspected owner session; it does not independently prove Render's runtime DATABASE_URL uses that exact role, so verify the runtime role without exposing credentials. `notification_preferences` also has RLS disabled. The notification controller is JWT-protected; preference reads/writes scope by both `company_id` and `user_id`, notification list/read updates likewise scope by company and recipient, and preference input keys/values are allow-listed. These code-level predicates reduce exposure through these routes but do not replace least-privilege DB access or policy-based defense in depth. Treat the RLS/role gap as a P0 defense-in-depth/release blocker: application query scoping remains essential, and effective runtime identity plus policies/grants need an explicit remediation plan before production. Do not apply policies or change DB roles during this read-only audit. Payroll controller routes require JWT, RBAC permissions (`payroll:read` for reports/exports), and `hr_workforce` entitlement; `getRun()` scopes both run and items by company and rejects branch-bound memberships for company-wide payroll. This is code-level evidence only, not a live negative test. Global search's controller uses JWT authentication; the service additionally gates each result category by the caller's specific read permission, active subscription/module dependencies, company scope, and branch filter where implemented. Payroll export review: annual summaries query posted runs by `company_id` and year and require company-wide payroll membership; individual run reports resolve through the company-scoped run lookup. CSV cells are escaped and formula-like prefixes are neutralized. This is a partial sample only, not proof for all service queries, files, exports, or async paths. Continue route-to-service authorization matrix and negative tests without mutating shared data | Open — partial code review recorded; full coverage/tests outstanding |
| FIND-04 | P0 | Contract status transition race was previously identified | Reinspection on `d8182c6` found `changeStatus()` reads the row `FOR UPDATE` inside a transaction and validates the locked status before updating; `contracts.service.spec.ts` includes a regression test rejecting an invalid locked status. No separate concurrent-session integration test was found in the inspected spec, so add one if practical before final release | Code-level fix and regression test verified; concurrency integration evidence still open |
| FIND-05 | P0 | Tax/credit-note correctness requires end-to-end server-side verification | Code review confirms configured company tax policy is enforced on product create/update and invoice creation; credit notes derive tax rate/treatment from locked original invoice lines, reject duplicate lines and excess credited quantity/value, update credited totals transactionally, and have focused unit tests. Still require broader end-to-end tests for policy changes, partial credits, rounding, and accounting/stock side effects before release | Server-side safeguards and focused tests verified in code; full end-to-end release evidence remains open |
| FIND-06 | P0 | Migration ordering and schema reproducibility need verification | [Run 40887731068](https://github.com/pestria72-code/Omega-Solutions/actions/runs/40887731068) passed clean PostgreSQL 16 install, idempotent rerun, and canonical workforce schema assertions. Version-aware ordering fixes the version-010/011 timing and orders workforce foundation before the same-prefix extension, matching read-only shared-schema metadata. Separate read-only comparison found 18 of 66 migration files absent from `omega_schema_migrations`; later migrations are recorded after several missing earlier entries. A new runner preflight now refuses to auto-apply across such gaps because files such as `032_inventory_weighted_average_cost.sql` contain data-changing `UPDATE`s. Existing schema and ledger must be reconciled with a reviewed, non-destructive plan; no shared DB changes were made. | Open — clean install verified; shared-schema migration ledger drift is a P0 upgrade blocker |
| FIND-07 | P1 | Paystack checkout previously returned 503 about test mode configuration despite reported variables being present | Read-only Render app logs for the development service show `modeIsTest=true`, `secretKeyPresent=true`, and `secretKeyHasTestPrefix=true` on 2026-10-29 10:54 UTC. Searches of that service's logs for `configuration check failed` and HTTP 503 checkout requests from 2026-10-28 through 2026-10-29 returned no matches. This does not prove checkout succeeds; confirm the exact API host receiving the failing request and correlate a fresh request with that service's logs before changing configuration | Open — observed process config appears valid; failure not reproduced in available logs |
| FIND-08 | P1 | Dashboard summaries may fetch full lists rather than aggregate endpoints | Reinspection of `api/src/dashboard/dashboard.service.ts` shows SQL aggregates for customer/supplier/product counts and balances, a six-month grouped invoice trend, overdue invoices capped at six, and low-stock products capped at eight; no full customer/supplier/product/invoice list download occurs in this service. Still validate query plans and response latency with representative data volumes | Initial code-level concern not reproduced in current service; load/performance evidence remains open |
| FIND-09 | P1 | Project-management UI may be template/static rather than a complete backend-backed module | Inspect route, API, schema, permissions, and workflows | Open |
| FIND-10 | P1 | First-run company onboarding completeness not yet verified | Run a clean, no-demo-data onboarding journey in isolated test environment | Open |
| FIND-11 | P1 | Production recovery and file-storage restore need evidence | Perform isolated restore drill and record results | Open |
| FIND-12 | P0 | `.github/workflows/configure-neon-auth-verification.yml` runs on manual dispatch and on a push affecting the workflow file; it PATCHes a hard-coded Neon project/branch Auth configuration using `NEON_API_KEY` | Confirm the referenced Neon project/branch is strictly development and assess whether config mutation should be manual-only with explicit approval; do not trigger during this audit | Confirmed / Open |
| FIND-13 | P0 | Several live smoke workflows target the shared development API; purchasing/payment/manufacturing workflows explicitly create financial, POS, HRM, inventory, or accounting records. Purchasing cleanup can run against the shared development DB when its secret is configured | Do not trigger these workflows under the no-business-data-mutation rule; review scripts and redesign fixtures for isolated/disposable test data before execution | Confirmed / Open |
| FIND-14 | P1 | `.github/workflows/validate-development.yml` performs a live development API health smoke as part of CI; other live smoke workflows use differing path filters and trigger policies | Document side effects and consistent gating so routine commits cannot unexpectedly mutate external state; verify health check remains read-only | Open |

| FIND-15 | P1 | Runtime mismatch: repository `.nvmrc` specifies Node 22.22.3 while the main validation workflow installs Node 24 | Confirm deployed runtime and package compatibility; align local, CI, and hosting runtime intentionally | Open |
| FIND-16 | P1 | `vite-version/` contains both `package-lock.json` and `pnpm-lock.yaml`; `nextjs-version/` also has a pnpm lockfile while root/API use npm | Confirm the canonical package manager per deployed frontend and remove or document unused lockfiles only after validating hosting configuration | Open |
| FIND-17 | P1 | Root `License.md` attributes the MIT copyright to ShadcnStore (2025); repository contains template-derived frontend assets | Verify upstream license and attribution obligations before changing notices or claiming Omega-owned licensing | Open |
| FIND-18 | P1 | MFA recovery-code consumption could race when concurrent requests used different codes | Atomic conditional SQL `array_remove` fix and regression assertions are present. `api/src/auth/mfa.service.postgres.spec.ts` deterministically forces concurrent reads and verifies distinct codes cannot restore each other; duplicate-code single-use is also tested. `.github/workflows/validate-development.yml` provisions ephemeral PostgreSQL 16 and sets `MFA_TEST_DATABASE_URL`. [CI run 40882243954](https://github.com/pestria72-code/Omega-Solutions/actions/runs/40882243954) executed the PostgreSQL test file (2 tests); all 57 test files / 419 tests passed. | Closed for this finding; keep broader MFA lifecycle and abuse checks open under AUTH-09/AUTH-10 |
| FIND-19 | P1 | Branch-bound members could retain valid sessions after their assigned branch was deactivated because session profile/membership queries checked company and membership status but not branch status | Updated `AuthService.getUserMembership()`, `AuthService.getActiveCompanies()`, and `MembershipsService` lookups to join the assigned branch within the same company and require it to be active when `branch_id` is set. Added auth and membership regression tests. [Run 40884159048](https://github.com/pestria72-code/Omega-Solutions/actions/runs/40884159048) passed for the initial fix. The follow-up selector filter and test then passed in [run 40884822606](https://github.com/pestria72-code/Omega-Solutions/actions/runs/40884822606): 57 test files / 423 tests passed, including 6 auth tests, 10 membership tests, and 2 isolated PostgreSQL MFA tests. | Closed for inactive-branch session and selector access; broader branch-scope tests remain open under SEC-06 |
| FIND-20 | P1 | Branch-bound managers with `audit:read` could retrieve audit-log records for other branches in the same company, including event metadata and IP addresses | `AuditController` now passes the authenticated membership's `branchId` to `AuditService.list`; the service adds a parameterized branch predicate. Company-wide memberships retain company-wide audit history. Regression coverage asserts branch parameterization. [CI run 40889755921 passed](https://github.com/pestria72-code/Omega-Solutions/actions/runs/40889755921), 57 files / 429 tests. | Fixed and CI-verified in development; continue broader branch-scope negative tests |
| FIND-21 | P0 | Shared development migration ledger/schema drift: 18 of 66 migration files are absent from `omega_schema_migrations`, while some later migrations are recorded and required tax snapshot columns are absent | Runner preflight now refuses unsafe automatic catch-up when earlier files are missing before later applied entries, and refuses an empty ledger when application tables already exist; migration 032 includes data-changing SQL. [CI run 40889755921](https://github.com/pestria72-code/Omega-Solutions/actions/runs/40889755921) verified the missing-row refusal/no-repair case; [run 40890902539](https://github.com/pestria72-code/Omega-Solutions/actions/runs/40890902539) verified the empty-ledger refusal. No shared DB changes were made. Need reconcile the actual schema and ledger using a reviewed, non-destructive plan, then validate upgrade behavior on a disposable clone. | Open — both guards verified; schema/ledger reconciliation remains a release blocker |
| FIND-22 | P1 | Duplicate supplier invoice numbers may not be blocked because the uniqueness index is absent in the inspected development schema | Read-only `pg_indexes` inspection found no `supplier_bills_supplier_invoice_number_unique` index; a read-only aggregate check found zero non-void duplicate groups. Added a transaction-scoped advisory lock keyed by company, supplier and normalized invoice number before the duplicate query, so concurrent API calls serialize even while the DB index is absent. [CI run 40892621229 passed](https://github.com/pestria72-code/Omega-Solutions/actions/runs/40892621229): `supplier-bills.service.spec.ts` passed and the full API suite passed (57 files / 435 tests, 2 skipped). The database unique index still requires approved schema reconciliation. | Application race mitigated and CI-verified; database index remains open |
| FIND-23 | P1 | MFA enrollment confirmation and disable routes were not covered by the shared auth rate-limit rules | Added database-backed per-IP throttles: enroll 5/minute, confirm 10/minute, disable 5/minute. Added guard tests asserting requests above each threshold return HTTP 429. [Validation run 40892821358 passed](https://github.com/pestria72-code/Omega-Solutions/actions/runs/40892821358). | Closed for these three MFA actions; broader verification/invitation/password-reset/export abuse coverage remains open under SEC-13 |
| FIND-24 | P0 | One positive-stock inventory level has zero weighted-average cost despite positive-cost inbound movement history | Read-only aggregate query found one affected level: quantity 4, inbound movement value 440, implied weighted-average cost 110 per unit. Migration 032 contains the historical backfill but is absent from the shared DB ledger; the runner correctly refuses unsafe catch-up. Added `api/scripts/test-weighted-average-cost-migration.mjs`, hard-gated to local `omega_migration_test`, and wired it into disposable PostgreSQL CI. [Run 40894669045](https://github.com/fielddataresearch83-cpu/Omega-Solutions-ERP/actions/runs/40894669045) shows the weighted-average backfill regression step passed: expected 110/unit, ignored non-positive inbound movements, preserved existing nonzero cost, and created the index. Shared anomaly remains open until an approved forward repair; no shared records changed. | Open — isolated regression passed; shared financial valuation anomaly remains unresolved |
| FIND-25 | P1 | Company-local business dates could differ from UTC/database dates around midnight, affecting POS, payroll, accounting and workforce | Added `businessDateAt` using the IANA timezone returned with active company membership. Applied it to POS checkout, payroll effective-date defaults and pay-setting cut-offs, accounting trial balance/reconciliation/ageing/journal reversal dates, and workforce punch-time assignment checks. Tests cover `Africa/Nairobi`, `America/Los_Angeles`, and invalid timezone handling; historical month-end arithmetic remains UTC. | Implemented; 557 API unit tests, lint and build pass locally. PostgreSQL/CI integration verification still pending. |
| FIND-26 | P0 | No API E2E coverage for critical cross-module business workflows; current `api/test/app.e2e-spec.ts` only checks `GET /api` | Add isolated-PostgreSQL E2E workflows: quotation → sales order → invoice → payment/journal; requisition → approval → PO → receipt/stock → supplier bill/payment; POS checkout → invoice/stock/COGS/journal; payroll run → approval/posting/remittance; manufacturing material consumption/output. Include idempotency, concurrency, cross-tenant and role-negative cases. | Open — unit tests exist; end-to-end workflows unverified |
| FIND-27 | P0 | Actual company/branch RLS migration test is added but has not executed against PostgreSQL | Run the wired `application-rls.e2e-spec.ts` in disposable PostgreSQL CI on a locally validated commit; inspect the run and confirm all 4 application-policy cases pass before marking RLS test evidence complete. | Open — local DB unavailable; CI pending |

## 18. Final release gates — all required

- [ ] **REL-01** No unresolved critical/high security or tenant-isolation findings.
- [ ] **REL-02** Required CI, unit, integration, tenant-security, and browser tests pass on the exact release candidate commit.
- [ ] **REL-03** No cross-company/branch/role/plan bypass in tested routes, files, exports, reports, or background jobs.
- [ ] **REL-04** Financial journals balance; stock, invoice, payment, payroll, and subscription effects are traceable and retry-safe.
- [ ] **REL-05** Clean migration and upgrade tests pass; backup/restore drill is successful.
- [ ] **REL-06** All critical navigation and advertised workflows are verified; no misleading placeholders or demo data.
- [ ] **REL-07** Secrets, environment scopes, domains, workflow targets, and billing modes are reviewed.
- [ ] **REL-08** Monitoring, incident response, privacy, support, retention, and commercial policies are ready.
- [ ] **REL-09** Known risks are documented with explicit acceptance by the responsible owner.
- [ ] **REL-10** User explicitly authorizes production release after reviewing the evidence.

**Production status:** NOT APPROVED until every required release gate above is checked and evidence is recorded.

## Evidence log

Append a row after each completed task. Link commits, CI runs, test reports, and relevant files. Do not paste secrets or personal/customer data.

| Date (UTC) | Checklist ID | Result | Evidence (commit/test/CI/file) | Notes / follow-up |
|---|---|---|---|---|
| 2026-11-20 | TEST-03 / TEST-05 / SEC-02 / DB-02 | Partial; no release sign-off | Commit 2e310e93; GitHub Validate Omega development run 44694467008; local PostgreSQL clean migration replay (86/86 twice); tenant RLS E2E (7/7); API suite (579 passed); critical workflow regressions (165 passed) | Fixed development-validation.yml RLS test environment mismatch locally; CI rerun pending. Isolated Neon branch ledger has 84/86 source migrations (two 20261118 migrations pending manual review/application); zero checksum drift among applied entries. App role is NOBYPASSRLS and cannot CREATE in public. RLS inventory: 110/113 company-scoped tables protected; auth_refresh_tokens, company_invitations, and company_memberships require design review. No Neon migration was applied and no Production resources were touched. |
| 2026-11-15 | TEST-03 / TEST-04 / TEST-06 / FIND-25–27 | Partial; no release sign-off | `npm test` (557 passed, 2 skipped); API `npm run lint` and `npm run build`; frontend `npm run lint` and `npm run build`; `api/src/common/business-date.ts`; `api/test/application-rls.e2e-spec.ts`; `.github/workflows/development-validation.yml` | Company-local business dates implemented and unit-tested across POS, payroll, accounting and workforce. Full API business-workflow E2E is absent; local PostgreSQL/Docker unavailable so RLS E2E remains unverified and awaits CI. No DB writes, commits, pushes or deployments. |
| 2026-10-29 | INV-06 / FIND-24 | P0 anomaly found; no mutation | [weighted-average cost migration](https://github.com/pestria72-code/Omega-Solutions/blob/development/api/src/migrations/032_inventory_weighted_average_cost.sql); [migration reconciliation report](https://github.com/pestria72-code/Omega-Solutions/blob/development/docs/MIGRATION_LEDGER_RECONCILIATION.md) | Read-only aggregate found 1 positive-stock level with zero average cost despite positive-cost inbound movement history. Do not rerun migration 032 automatically; verify and repair through a reviewed, authorized procedure. |
| 2026-10-29 | SEC-05 / tenant smoke | Partial verified | [read-only tenant smoke run 40892552889](https://github.com/pestria72-code/Omega-Solutions/actions/runs/40892552889); [smoke script](https://github.com/pestria72-code/Omega-Solutions/blob/development/api/scripts/live-auth-tenant-readonly-smoke.mjs) | Verified selected-company session exchange, active company choices, cross-company company-profile/branch-list denial, and client-supplied companyId not overriding token context. Partial coverage only; does not prove every route, file, export, branch or async path. |
| 2026-10-29 | FIN-02 / FIND-22 | P1 gap found; no mutation | [supplier uniqueness migration](https://github.com/pestria72-code/Omega-Solutions/blob/development/api/src/migrations/202610260005_supplier_invoice_number_uniqueness.sql); [read-only index inspection](https://github.com/pestria72-code/Omega-Solutions/blob/development/docs/PRODUCTION_READINESS_MAP.md) | `supplier_bills.supplier_invoice_number` exists but the unique index `supplier_bills_supplier_invoice_number_unique` is absent from `pg_indexes`. The migration refuses to proceed if duplicates exist; read-only duplicate aggregate returned zero groups/rows at inspection time. Do not apply the index until the migration ledger repair plan is approved. |
| 2026-10-29 | DB-03 / FIND-21 | P0 gap found; automatic catch-up guards verified in CI | [read-only ledger/schema inspection](https://github.com/pestria72-code/Omega-Solutions/blob/development/api/scripts/migrate.mjs); [runner guard](https://github.com/pestria72-code/Omega-Solutions/blob/development/api/scripts/migrate.mjs); [missing tax snapshot migration](https://github.com/pestria72-code/Omega-Solutions/blob/development/api/src/migrations/202610260003_transaction_tax_snapshots.sql) | Shared development ledger contains 48 entries for 66 migration files (18 missing); no alternate `pgmigrations` ledger exists. Several objects exist despite missing ledger rows, proving schema and ledger drift. `invoice_items.tax_treatment`, `quotation_items.tax_treatment`, `supplier_bill_items.tax_treatment`, and `credit_note_items.invoice_item_id/tax_treatment` are absent in inspected schema while current services query/insert them. The unique index `supplier_bills_supplier_invoice_number_unique` is also absent although its migration is missing; duplicate non-void supplier invoice numbers may therefore not be blocked. The runner now refuses unsafe catch-up when a missing migration precedes later applied migrations or when application tables exist with an empty ledger; [CI run 40890902539](https://github.com/pestria72-code/Omega-Solutions/actions/runs/40890902539) passed clean-install/schema assertions and both safety-guard simulations without mutating shared data. Do not run normal migrations on shared DB: migration 032 contains data-changing SQL. Reconcile via reviewed schema-only plan and isolated tests. |
| 2026-10-29 | MAP-INIT | Created map | Commit `5362ebc96cfb36c119c0a2ba86257edffecd9202` | Audit map established |
| 2026-10-29 | FIND-23 | Verified / closed | [Validation run 40892821358](https://github.com/pestria72-code/Omega-Solutions/actions/runs/40892821358); [auth rate-limit guard](https://github.com/pestria72-code/Omega-Solutions/blob/development/api/src/auth/auth-rate-limit.guard.ts) | MFA enroll, confirm, and disable throttle tests passed; broader auth abuse-rate-limit review remains open. |
| 2026-10-29 | RC-01 | Verified | [development branch HEAD](https://github.com/pestria72-code/Omega-Solutions/commit/5362ebc96cfb36c119c0a2ba86257edffecd9202) | Existing `development` branch confirmed; no branch created |
| 2026-10-29 | RC-02 / RC-03 / RC-04 / RC-05 | Partial / findings opened | [workflow directory](https://github.com/pestria72-code/Omega-Solutions/tree/development/.github/workflows); [deploy.yml](https://github.com/pestria72-code/Omega-Solutions/blob/development/.github/workflows/deploy.yml); [branch status](https://github.com/pestria72-code/Omega-Solutions/tree/development) | Listed 14 workflow files. Confirmed unrelated manual ShadcnStore production deployment workflow; current branch protection is off. Full workflow/script/hosting review remains open.

## Session handoff template

At the end of each work session, update this block:

- **Reviewed source HEAD:** `development` — `e6a01dc6025754f9bf20d191bd06d01404f139f2` (2026-10-29), plus the audit-map update commit that follows.
- **Checklist IDs completed this session:** MFA recovery-code concurrency verified in `40882243954`; inactive-branch session/company selection and branch-scoped audit log fixes verified in `40884822606` and `40889755921`; supplier invoice advisory lock and MFA route throttling verified in `40892621229` (57 files / 435 tests, 2 skipped). Read-only tenant isolation smoke passed in `40892552889`. P0 RLS and migration-ledger/schema drift remain open.
- **Evidence recorded:** [validation run 40882243954](https://github.com/pestria72-code/Omega-Solutions/actions/runs/40882243954) completed successfully. Its logs show `mfa.service.postgres.spec.ts (2 tests)`, 57 test files passed, and 419 tests passed against ephemeral PostgreSQL 16. Additional code-level controller review confirms guards and permissions are present on the inspected modules; this is not a substitute for isolated authorization-negative tests. Render metadata confirms development API auto-deploy is off and healthCheckPath is unset. Read-only live Neon catalog check found zero public policies, 55 RLS-enabled tables, `neondb_owner` with BYPASSRLS, and RLS disabled on notification_preferences. Notification endpoints are JWT-protected and company/recipient scoped at code level. Branch remains unprotected with required checks off.
- **Findings opened/closed:** FIND-03 remains a P0 release blocker. FIND-18, FIND-19, FIND-20, and FIND-23 are closed for their targeted fixes. FIND-21 remains an open P0 migration-ledger/schema gap. FIND-22 is partially mitigated by the application lock, but the DB unique index remains open. Confirm Render runtime DB role and design/test least-privilege tenant isolation in an isolated DB.
- **Tests/CI run and result:** Run `40882243954` passed on commit `e9b58b23b07f2881921291de2b21448c16b3292d`; run `40884822606` passed on `6995052378d75be34892ac56ce904d532c9c8171` with 57 test files / 423 tests, including branch-inactive authorization and PostgreSQL MFA concurrency integration. Migration-smoke initially failed at migration 013; corrected ordering and foundation-first duplicate-prefix ordering passed clean install, idempotent rerun, and canonical schema assertions in `40887731068`. Read-only ledger comparison found 18 missing migration entries; automatic catch-up is now guarded and verified in CI; tax snapshot, credit-note link, and supplier-invoice uniqueness repairs remain open.
- **Next exact checklist ID:** SEC-01 / SEC-04 / SEC-05 and DB-03 — finish authorization-negative matrix, verify runtime DB role safely, implement/test RLS in isolated PostgreSQL using the design doc, and reconcile the shared migration ledger only after explicit authorization.
- **Files or areas not to re-audit unless changed:** Product image ownership/signing, global search permission/module gates, payroll export query scoping and CSV formula neutralization already reviewed at code level; re-open only if files change or tests expose gaps.
- **Production/data mutation:** None.

## Reference standards

- [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/)
- [Kenya Office of the Data Protection Commissioner](https://www.odpc.go.ke/data-protection-compliance/)

---
*This document is an audit tracker, not proof of compliance. Completion requires recorded, reproducible evidence.*

| 2026-10-29 | DB-03 / FIND-21 / FIND-03 | Fresh read-only catalog comparison; no mutation | [schema reconciliation plan](https://github.com/pestria72-code/Omega-Solutions/blob/development/docs/DEVELOPMENT_SCHEMA_RECONCILIATION_PLAN.md) | Rechecked the intended development branch with SELECT/catalog queries only. Confirmed the inspection connection is `neondb_owner` with `rolbypassrls=true` (not proof of Render runtime identity); 48 ledger entries remain with 18 migration files missing. Several expected objects exist despite ledger gaps, but not all expected definitions match: migration 024 employee foreign-key delete actions differ, expected POS open-shift unique indexes are absent, tax snapshot/credit-note link columns and checks are absent, and supplier-invoice uniqueness index is absent. RLS remains enabled on 55 public tables with zero policies. Shared DB unchanged. Full validation passed on preceding commit `9c748e5`; docs-only migration report at `3ff399e` awaits its own CI run. | Open — isolated full schema diff and tenant policy tests required |


## Follow-up evidence correction — 2026-10-30

- [Development validation run 40909097738](https://github.com/pestria72-code/Omega-Solutions/actions/runs/40909097738) completed successfully on commit `85bf9d094a4efe8f9d916b830628462c9263f34a`. API build/tests/lint, purchase-order approval regression, frontend build, and dependency-audit reporting passed.
- **Correction to the 2026-10-29 DB-03/FIND-21 note:** a broader read-only `pg_indexes` query confirms that both POS partial unique indexes `uq_pos_one_open_shift_per_register` and `uq_pos_one_open_shift_per_cashier_company` are present and match migration 030's declared keys/predicates. The earlier targeted query's “absent” result was incomplete; do not treat these two indexes as a schema gap or attempt to create them.
- The tax snapshot and credit-note link columns remain absent from the inspected schema, and `supplier_bills_supplier_invoice_number_unique` remains absent. The 18 migration-ledger gaps remain unresolved. No database writes or deployments were performed.
- Follow-up details are recorded in [the schema reconciliation plan](https://github.com/pestria72-code/Omega-Solutions/blob/development/docs/DEVELOPMENT_SCHEMA_RECONCILIATION_PLAN.md). The full catalog output was truncated, so exact all-object reconciliation is still outstanding.


## Latest checkpoint audit — 2026-11-17

**Workspace and Git state**
- Workspace HEAD: `0f3adcb48ac2993b6bf5a68d8c2361dc70b139fe` (`Complete development workflow hardening and timezone support`).
- `origin/development` at last fetch: `ea130a9219fd12105347157bbfdd3d0a2bfa5048`; workspace is two commits ahead.
- Two local commits are present: `c302e6f2` (Midnight ERP UI design system) and `0f3adcb4` (development workflow hardening and timezone support).
- Preserved uncommitted files: modified `api/src/companies/dto/company.dto.ts` and new `api/src/companies/dto/company.dto.spec.ts` (valid/invalid IANA timezone validation). No deletions were reported.
- No push, deployment, migration, shared Neon write or Production change was performed during this audit.

**Validation evidence**
- API unit suite: **559 passed, 2 skipped**; 70 test files passed and 1 skipped (71 total).
- API lint (`oxlint src/ test/`): passed, zero warnings/errors.
- API production build (`nest build`): passed.
- Frontend lint (`eslint .`): passed.
- Frontend production build (`tsc -b && vite build`): passed; 3,815 modules transformed.
- `git diff --check`: passed.
- PostgreSQL RLS E2E invocation exited successfully but **all 7 tests were skipped** because no disposable local PostgreSQL `DATABASE_URL` was available. This is not evidence that tenant isolation/RLS passes.

**Readiness decision**
- The local code-quality gate is green, but this checkpoint is **not production-ready**. P0 remains: execute and pass tenant-isolation/RLS tests against disposable PostgreSQL in CI, then add PostgreSQL-backed critical workflow E2E coverage. P1 remains: live Preview acceptance for dashboard, company/branch context, navigation and Inventory.
- Do not treat skipped PostgreSQL tests as passing. Keep Production and its database untouched.
