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
- [ ] Confirm latest branch HEAD and CI status before each new audit session.
- [ ] Build a file/route/controller/service/schema/test inventory from the current repository; do not rely on prior summaries alone.
- [ ] Establish baseline test commands and record current pass/fail results.
- [ ] Audit remaining sections below in priority order.

**Last completed task:** Created the production-readiness map.  
**Next task:** P0-1 — release controls and deployment workflow audit.  
**Last reviewed commit:** `ecef9cebde0a65e2882dab1ca7421de4090d2c26`. Reconfirm before relying on this baseline.

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

- [ ] **RC-01** Confirm current `development` HEAD and ensure all work targets this existing branch only.
- [ ] **RC-02** Inventory every GitHub Actions workflow, reusable workflow, deployment script, package script, and hosting integration.
- [ ] **RC-03** For every workflow, document trigger, permissions, secrets, target environment, and whether it can deploy or mutate data.
- [ ] **RC-04** Identify and quarantine/disable only with approval any workflow that targets unrelated projects or production; never trigger the ShadcnStore deployment workflow.
- [ ] **RC-05** Review branch protection/rulesets and required checks. Baseline observation: GitHub reported `development` unprotected with no required status checks at the recorded commit; recheck current state.
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
| FIND-01 | P0 | Development branch was observed unprotected with no required checks at baseline | Recheck GitHub settings; agree/implement safe branch governance | Open |
| FIND-02 | P0 | A workflow named “Deploy Template to ShadcnStore” was previously observed | Inspect workflow and target; never trigger it during this audit | Open |
| FIND-03 | P0 | Cross-tenant isolation must be proven across every route and async/file/report path | Build route-level authorization matrix and negative tests | Open |
| FIND-04 | P0 | Contract status transition race was previously identified | Reinspect current implementation; make validation/update atomic and add concurrency test if still present | Open |
| FIND-05 | P0 | Tax/credit-note correctness requires end-to-end server-side verification | Recheck current code and regression tests; confirm original-invoice tax and credit limits | Open |
| FIND-06 | P0 | Migration ordering and schema reproducibility need verification | Test clean install and upgrade on disposable PostgreSQL databases | Open |
| FIND-07 | P1 | Paystack checkout previously returned 503 about test mode configuration despite reported variables being present | Trace config loading and runtime environment scope without exposing secrets | Open |
| FIND-08 | P1 | Dashboard summaries may fetch full lists rather than aggregate endpoints | Profile current routes and replace only where verified necessary | Open |
| FIND-09 | P1 | Project-management UI may be template/static rather than a complete backend-backed module | Inspect route, API, schema, permissions, and workflows | Open |
| FIND-10 | P1 | First-run company onboarding completeness not yet verified | Run a clean, no-demo-data onboarding journey in isolated test environment | Open |
| FIND-11 | P1 | Production recovery and file-storage restore need evidence | Perform isolated restore drill and record results | Open |

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
| 2026-10-29 | MAP-INIT | Created map | Initial baseline `ecef9cebde0a65e2882dab1ca7421de4090d2c26` | All substantive audit checks remain unchecked pending fresh verification |

## Session handoff template

At the end of each work session, update this block:

- **Current branch / HEAD:**
- **Checklist IDs completed this session:**
- **Evidence recorded:**
- **Findings opened/closed:**
- **Tests/CI run and result:**
- **Next exact checklist ID:**
- **Files or areas not to re-audit unless changed:**
- **Production/data mutation:** None unless explicitly authorized (record any approved exception).

## Reference standards

- [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/)
- [Kenya Office of the Data Protection Commissioner](https://www.odpc.go.ke/data-protection-compliance/)

---
*This document is an audit tracker, not proof of compliance. Completion requires recorded, reproducible evidence.*
