# Omega Solutions — Production Readiness Map

> **Single source of truth for the production-readiness audit.** Update this file as work is completed so the same checks are not repeated.
>
> Repository: [pestria72-code/Omega-Solutions](https://github.com/pestria72-code/Omega-Solutions)  
> Working branch: `development` only  
> Initial baseline checked: `ecef9cebde0a65e2882dab1ca7421de4090d2c26` (2026-10-29)  
> Status: **AUDIT IN PROGRESS — not approved for production**

## Operating rules

1. Work only on the existing `development` branch. **Never create a branch** for testing, fixes, previews, or experiments.
2. Do not intentionally change, deploy to, or mutate production. Do not use production data for tests.
3. Do not mutate business data in the shared development database during audit. Use isolated/disposable test databases or controlled fixtures for tests that require writes.
4. Do not add demo/sample business data or bypass authentication. Do not use the prohibited dashboard E2E account.
5. Inspect and document evidence before changing code. Fix one coherent issue at a time, add/regress tests, and run relevant CI before moving on.
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
- This is a manually maintained Markdown checklist; it is not a GitHub Actions automation. The agreed workflow is to update it after each completed/verified task.

## Current checkpoint

- [x] Created this audit map on `development`.
- [x] Confirm latest branch HEAD and CI status before each new audit session. Evidence (2026-10-29): `development` HEAD `e320c450ba1dd9fe64c5616a60b6fd68b3834fef`; Development validation run [40875774674](https://github.com/pestria72-code/Omega-Solutions/actions/runs/40875774674) completed successfully.
- [ ] Build a file/route/controller/service/schema/test inventory from the current repository; do not rely on prior summaries alone.
- [ ] Establish baseline test commands and record current pass/fail results.
- [ ] Audit remaining sections below in priority order.

**Last completed task:** RC-01 — confirmed branch and HEAD.  
**Next task:** RC-02 — complete workflow/script/hosting target inventory; RC-03 — document triggers, permissions, secrets, and effects.  
**Current branch:** `development` (existing branch only).  
**Current HEAD:** `5362ebc96cfb36c119c0a2ba86257edffecd9202` (map creation commit).  
**Prior code baseline:** `ecef9cebde0a65e2882dab1ca7421de4090d2c26`.

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

- [x] **RC-01** Confirm current `development` HEAD and ensure all work targets this existing branch only. Evidence: GitHub branch API checked 2026-10-29; HEAD `5362ebc96cfb36c119c0a2ba86257edffecd9202`.
- [x] **RC-02** Inventory every GitHub Actions workflow, reusable workflow, deployment script, package script, and hosting integration. Evidence: enumerated all 14 `.github/workflows/*.yml` files, root/API/Vite/Next.js package scripts, `vite-version/vercel.json`, and deployment guidance/config references in `docs/`; no root `render.yaml`, `Dockerfile`, `netlify.toml`, or `railway.json` appeared in the recursive repository tree.
- [x] **RC-03** For every workflow, document trigger, permissions, secrets, target environment, and whether it can deploy or mutate data. Evidence: all 14 workflow YAML files reviewed for triggers, permissions, referenced credentials, target environments, and side effects. No live workflow was triggered.
- [x] **RC-04** Remove the unrelated ShadcnStore deployment workflow from Omega's `development` branch. Evidence: deleted `.github/workflows/deploy.yml` in commit `16a75bbfcc65b383f3bc16fe1a7ebc0f70c1c9c7`; this removes the workflow definition from this repo and does not alter the remote ShadcnStore server.
- [ ] **RC-05** Review branch protection/rulesets and required checks. Rechecked 2026-10-29: `development` remains `protected: false`, with no required status checks. The connected GitHub integration cannot read the branch-protection endpoint (403); repository rulesets are unavailable on the current private-repository plan (403). This remains an open governance blocker; configure required CI checks in GitHub repository settings when the owner/admin UI or a suitably authorized connection is available. Do not claim protection is enabled.
- [ ] **RC-06** Confirm CI runs on relevant pushes and that failed checks block release through a documented process.
- [ ] **RC-07** Replace template-like root documentation with accurate setup, architecture, test, deployment, and recovery guidance.
- [ ] **RC-08** Confirm dependency lockfiles, supported Node/runtime versions, license notices, and no accidental generated artifacts.
- [ ] **RC-09** Scan repository history and tracked files for committed secrets; rotate any exposed credentials through the provider if found.
- [ ] **RC-10** Verify frontend and API deployment projects, root directories, build commands, environment scopes, domains, and deployment targets without deploying.
- [ ] **RC-11** Verify the release process requires explicit human approval and never deploys production automatically from this audit.

**Acceptance:** All workflows and targets are known; no accidental production path; required CI and review gates are documented and enforced.

## 2. Tenant isolation, authorization, and data access — P0

- [ ] **SEC-01** Inventory every API controller/route and map it to authentication, company scope, branch scope, role/permission, module entitlement, and subscription-plan enforcement.
- [ ] **SEC-02** Trace company context from verified identity/session through every service and database query; reject client-supplied tenant IDs unless independently authorized.
- [ ] **SEC-03** Verify active membership and company switching; inactive/revoked memberships must be rejected immediately.
- [ ] **SEC-04** Review PostgreSQL roles, grants, ownership, connection pooling, and all RLS-enabled tables; verify actual policies and runtime role behavior rather than assuming RLS is present or absent.
- [ ] **SEC-05** Test cross-company access for list, read, create, update, delete, search, exports, reports, attachments, images, imports, notifications, and background jobs.
- [ ] **SEC-06** Test branch restrictions for stock, POS, sales, staff, reports, and all branch-aware endpoints.
- [ ] **SEC-07** Test role boundaries for owner, administrator, finance, procurement, HR, manager, and salesperson; verify enforcement in API/service, not only UI.
- [ ] **SEC-08** Verify subscription status and module entitlements are enforced server-side on every protected route and background job.
- [ ] **SEC-09** Review IDOR/BOLA, mass assignment, unsafe object binding, pagination/filter injection, SQL injection, and insecure direct file access.
- [ ] **SEC-10** Verify audit logs for sensitive actions are tenant-scoped, tamper-resistant enough for the threat model, and do not record secrets.
- [ ] **SEC-11** Run automated tenant-regression tests against isolated fixtures; record positive and negative cases.
- [ ] **SEC-12** Verify uploaded files/product images are tenant-isolated, validated, size-limited, and inaccessible by guessing storage keys.
- [ ] **SEC-13** Verify rate limits and abuse protections on login, verification, invitations, password reset, exports, and expensive endpoints.

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

- [ ] **DB-01** Inventory migration files and determine the authoritative migration ordering, checksums, and duplicate/legacy numbering.
- [ ] **DB-02** Verify a clean database can be built from migrations alone in the intended order.
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
| FIND-03 | P0 | Cross-tenant isolation must be proven across every route and async/file/report path | Initial read-only spot-check on `development` HEAD `2fea9b3`: company reads use membership checks; branch services check company membership and branch-bound membership; audit-log and notification queries scope by company and, where applicable, user; CRM, expenses, employees, approvals, and other reviewed controllers apply JWT/RBAC guards (some also module-entitlement guards). Additional spot-check: global search returns no results without a company context and scopes customer/product/supplier/invoice searches by `company_id`; employee results also apply the user's branch filter. Payroll and manufacturing controllers use JWT, RBAC, and module-entitlement guards. Product-image upload/remove resolves the selected-company membership, verifies product ownership by `(id, company_id)`, validates image signatures and size, uses tenant-prefixed storage keys, and returns short-lived signed read URLs; focused tests cover foreign-company image upload denial and replacement/removal. Invoice and purchase-order notification triggers select only active memberships and active users in `NEW.company_id`, while notification reads/updates are scoped by company and recipient. Caveat: migration `038_notifications.sql` enables RLS but does not define a policy in that migration. Read-only inventory of all current migrations and repository search found no explicit `CREATE POLICY` definition for notifications; this is not proof of effective database policy state, so verify live catalogs and the actual DB connection role/RLS behavior before relying on RLS. Migration `20261019000000_notification_preferences.sql` creates `notification_preferences` without enabling RLS; its service access controls and grants need review. Payroll controller routes require JWT, RBAC permissions (`payroll:read` for reports/exports), and `hr_workforce` entitlement; `getRun()` scopes both run and items by company and rejects branch-bound memberships for company-wide payroll. This is code-level evidence only, not a live negative test. Global search's controller uses JWT authentication; the service additionally gates each result category by the caller's specific read permission, active subscription/module dependencies, company scope, and branch filter where implemented. Payroll export review: annual summaries query posted runs by `company_id` and year and require company-wide payroll membership; individual run reports resolve through the company-scoped run lookup. CSV cells are escaped and formula-like prefixes are neutralized. This is a partial sample only, not proof for all service queries, files, exports, or async paths. Continue route-to-service authorization matrix and negative tests without mutating shared data | Open — partial code review recorded; full coverage/tests outstanding |
| FIND-04 | P0 | Contract status transition race was previously identified | Reinspection on `d8182c6` found `changeStatus()` reads the row `FOR UPDATE` inside a transaction and validates the locked status before updating; `contracts.service.spec.ts` includes a regression test rejecting an invalid locked status. No separate concurrent-session integration test was found in the inspected spec, so add one if practical before final release | Code-level fix and regression test verified; concurrency integration evidence still open |
| FIND-05 | P0 | Tax/credit-note correctness requires end-to-end server-side verification | Code review confirms configured company tax policy is enforced on product create/update and invoice creation; credit notes derive tax rate/treatment from locked original invoice lines, reject duplicate lines and excess credited quantity/value, update credited totals transactionally, and have focused unit tests. Still require broader end-to-end tests for policy changes, partial credits, rounding, and accounting/stock side effects before release | Server-side safeguards and focused tests verified in code; full end-to-end release evidence remains open |
| FIND-06 | P0 | Migration ordering and schema reproducibility need verification | Test clean install and upgrade on disposable PostgreSQL databases | Open |
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
| 2026-10-29 | MAP-INIT | Created map | Commit `5362ebc96cfb36c119c0a2ba86257edffecd9202` | Audit map established |\n| 2026-10-29 | RC-01 | Verified | [development branch HEAD](https://github.com/pestria72-code/Omega-Solutions/commit/5362ebc96cfb36c119c0a2ba86257edffecd9202) | Existing `development` branch confirmed; no branch created |\n| 2026-10-29 | RC-02 / RC-03 / RC-04 / RC-05 | Partial / findings opened | [workflow directory](https://github.com/pestria72-code/Omega-Solutions/tree/development/.github/workflows); [deploy.yml](https://github.com/pestria72-code/Omega-Solutions/blob/development/.github/workflows/deploy.yml); [branch status](https://github.com/pestria72-code/Omega-Solutions/tree/development) | Listed 14 workflow files. Confirmed unrelated manual ShadcnStore production deployment workflow; current branch protection is off. Full workflow/script/hosting review remains open.

## Session handoff template

At the end of each work session, update this block:

- **Current branch / HEAD:** `development` — `a8558ff5113a9b7a18a1086cc808feb16591b94d` (confirmed 2026-10-29).
- **Checklist IDs completed this session:** None; continued read-only review. RC/SEC gates remain open.
- **Evidence recorded:** Latest Development validation run `40877650481` succeeded; payroll export controller/service checks; notification migration inventory and RLS caveat; branch remains unprotected with required checks off.
- **Findings opened/closed:** No findings closed. Notification RLS policy/runtime-role verification and notification-preferences access/grants remain open follow-ups under SEC-04/SEC-05 and FIND-03.
- **Tests/CI run and result:** Read-only GitHub review; existing validation run succeeded. No business-data tests executed.
- **Next exact checklist ID:** SEC-04 / SEC-05 — inspect DB roles/grants and route-to-service authorization matrix, then plan isolated negative tests.
- **Files or areas not to re-audit unless changed:** Product image ownership/signing, global search permission/module gates, payroll export query scoping and CSV formula neutralization already reviewed at code level; re-open only if files change or tests expose gaps.
- **Production/data mutation:** None.

## Reference standards

- [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/)
- [Kenya Office of the Data Protection Commissioner](https://www.odpc.go.ke/data-protection-compliance/)

---
*This document is an audit tracker, not proof of compliance. Completion requires recorded, reproducible evidence.*
