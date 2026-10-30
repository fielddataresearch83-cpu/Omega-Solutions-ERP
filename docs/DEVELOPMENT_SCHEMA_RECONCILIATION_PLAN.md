# Omega development schema and migration-ledger reconciliation plan

**Status:** Review plan only — not an execution authorization.  
**Target:** Existing Neon development branch `omega-migration-smoke-test-live`, database `neondb`.  
**Safety:** No SQL in this document is to be executed against the shared database without an approved, rehearsed forward-repair procedure. Production is out of scope.

## Read-only evidence

- Repository migration directory contains 66 SQL migration files at the reviewed development source tree.
- `public.omega_schema_migrations` contains 48 distinct filename entries; 18 repository migration filenames are absent, and no ledger filename was absent from the repository at inspection time.
- The shared database catalog has been inspected read-only. `invoice_items.tax_treatment`, `quotation_items.tax_treatment`, `supplier_bill_items.tax_treatment`, `credit_note_items.invoice_item_id`, and `credit_note_items.tax_treatment` were absent in the inspected schema.
- `supplier_bills.supplier_invoice_number` exists, but `supplier_bills_supplier_invoice_number_unique` was absent. The earlier read-only duplicate aggregate reported no duplicate groups at that inspection time; recheck immediately before any index creation.
- The migration runner intentionally refuses to catch up automatically across ledger gaps or when an existing application schema has an empty/missing ledger. Do not remove those protections.
- These observations describe the inspected state only; refresh them before any future remediation because the branch/database may change.

## The 18 ledger gaps

The following files exist in the repository but were absent from the shared database ledger at inspection time:

1. `024_workforce_attendance_assignments.sql`
2. `025_monthly_attendance_import.sql`
3. `030_pos_registers_and_shifts.sql`
4. `031_pos_checkout.sql`
5. `032_inventory_weighted_average_cost.sql`
6. `034_company_invitations.sql`
7. `035_user_mfa.sql`
8. `037_credit_note_staff_read.sql`
9. `040_product_image_url.sql`
10. `046_subscription_paystack_payments.sql`
11. `047_auth_rate_limits.sql`
12. `048_auth_refresh_tokens.sql`
13. `20261018000000_product_image_storage.sql`
14. `2026101801_add_product_image_columns.sql`
15. `202610210001_mpesa_stk_push.sql`
16. `202610260003_transaction_tax_snapshots.sql`
17. `202610260005_supplier_invoice_number_uniqueness.sql`
18. `202610260006_credit_note_invoice_line_links.sql`

The ledger contains some later migrations despite these gaps, so replaying all missing files in filename order is unsafe. Some features may have been installed manually or through an earlier non-canonical path; absence from the ledger alone does not prove that every object in a file is absent.

## Required reconciliation sequence

### Gate 0 — Freeze and capture evidence

1. Confirm the exact development branch, database, and current application commit.
2. Take and verify a restorable database backup/snapshot using the platform-supported process. Keep backup access restricted.
3. Export a schema-only snapshot (definitions, indexes, constraints, triggers, policies, ownership/grants) and capture the complete migration ledger. Do not include business-row data in this artifact.
4. Record catalog state for every object referenced by all 66 migrations and check constraints, indexes, policies, functions, triggers, and data transformations.
5. Do not run the ordinary migration runner against the shared schema while ledger drift exists.

### Gate 1 — Rehearse on an isolated clone

1. Restore a recent snapshot to an isolated/disposable Neon branch or PostgreSQL instance, not the shared business database.
2. Run the current migration runner from clean install and verify idempotency.
3. Reproduce the shared database's *schema and ledger state* in the isolated clone, including the 18 missing ledger rows and existing objects, without copying sensitive business records where avoidable.
4. Test each proposed repair and rollback/recovery procedure on the clone. Verify that a failed step leaves the application schema usable and the migration history unambiguous.
5. Run application build/tests, tenant isolation negatives, and schema assertions against the clone before considering shared execution.

### Gate 2 — Classify each missing migration by observed effects

For each missing migration, compare its SQL with live catalog objects and constraints. Classify it as:
- **Already fully applied:** every expected object/constraint/index/data invariant exists and matches; only then consider a separately reviewed ledger reconciliation entry.
- **Partially applied:** create a purpose-built idempotent forward repair for the missing pieces; do not replay the whole historical file blindly.
- **Not applied:** apply the migration only after dependencies, existing data, lock duration, rollback/recovery, and expected row effects are reviewed.
- **Conflicting/data-dependent:** stop for explicit data owner review; no automatic repair.

Data-dependent items needing special scrutiny:
- `025_monthly_attendance_import.sql`: national-ID uniqueness can fail on duplicate existing values.
- `031_pos_checkout.sql`: includes backfill of missing POS request IDs before enforcing NOT NULL/uniqueness.
- `032_inventory_weighted_average_cost.sql`: updates existing stock valuation rows from inbound movements; validate the accounting/valuation impact before any backfill.
- `034_company_invitations.sql`: includes a pending-invitation uniqueness index; inspect existing pending invitations first.
- `202610260003_transaction_tax_snapshots.sql`: requires a documented legacy tax-treatment value and explicit not-null/check behavior; do not recalculate historical transaction amounts.
- `202610260005_supplier_invoice_number_uniqueness.sql`: aborts on duplicate supplier invoice references; rerun duplicate checks immediately before the index is created.
- `202610260006_credit_note_invoice_line_links.sql`: inspect historical credit-note lines before enforcing original-invoice-line links or uniqueness.
- `024_workforce_attendance_assignments.sql` and `025_monthly_attendance_import.sql`: review RLS state and all policies/grants; enabling RLS without policies can block non-owner access, while owner/BYPASSRLS access can bypass it.

### Gate 3 — Prepare a forward-only repair bundle

1. Create a reviewed, additive repair script with explicit preconditions and postconditions for each actual catalog gap; avoid destructive resets and silent data rewrites.
2. Keep data transformation separate from DDL where this improves reviewability and recovery.
3. Make each step transactional where PostgreSQL permits it; document non-transactional operations and lock/availability impact.
4. Do not insert missing rows into `omega_schema_migrations` merely to make the runner pass. A ledger row may be reconciled only after the corresponding migration effects are proven complete and a reviewer approves the exact filenames/checksums.
5. Add preflight checks that stop on unexpected schema, duplicate data, wrong object definitions, unknown ledger entries, or version drift.
6. Provide a tested rollback or forward-recovery instruction for every step; do not promise rollback for irreversible data transformations.

### Gate 4 — Review, authorize, execute, verify

Before shared development execution, require:
- a reviewed schema diff and exact SQL bundle;
- verified backup/restore;
- isolated rehearsal evidence;
- fresh duplicate/conflict checks;
- an explicit approval of the shared development DB change window;
- no production target or production credentials in the execution environment.

After approval and execution, verify catalog definitions, constraints, indexes, ledger/checksums, application smoke tests, tenant negatives, and critical finance/stock workflows. Record actual output and the exact commit/DB branch. Production remains separately blocked until all release gates pass and the user explicitly authorizes a release.

## Do not do these things

- Do not delete/recreate the shared development database.
- Do not run every missing migration blindly or mark all 18 as applied.
- Do not change historical invoice, credit-note, payroll, stock, or journal amounts to make constraints pass.
- Do not turn RLS on/off or add permissive policies as a shortcut.
- Do not deploy production or use production data to test repairs.


## Fresh read-only catalog comparison — 2026-10-29

**Target verified:** Neon project `Omega Solutions`, branch `omega-migration-smoke-test-live` (`br-snowy-block-b4pwz78t`), database `neondb`. All queries in this review were SELECT/catalog reads only. No shared database objects or rows were changed.

### Confirmed current state

- The migration ledger still contains 48 filenames; these 18 repository migration files remain absent from the ledger. This is a ledger fact, not proof that every migration's DDL is absent.
- The database identity used for this catalog inspection was `neondb_owner`, with `rolbypassrls=true`. **This is the inspection connection, not verified evidence of the Render API runtime identity.** Runtime identity remains open.
- The expected objects from many missing migrations already exist, but presence alone does not prove the migration was applied equivalently. Compare full column definitions, constraints, indexes, data invariants, and migration checksums on an isolated clone before classifying any as fully applied.
- `products.image_url` and `products.image_storage_key` and their storage-key index exist.
- `employees.national_id` and `idx_employees_company_national_id` exist. The monthly attendance import tables and many expected constraints also exist.
- POS register/shift/sale tables exist. `invoice_payments.pos_shift_id`, the composite shift/invoice constraints, `idx_pos_sales_company_request_id`, and both expected one-open-shift partial unique indexes exist. A later complete `pg_indexes` read on 2026-10-30 confirmed `uq_pos_one_open_shift_per_register` and `uq_pos_one_open_shift_per_cashier_company`; the earlier targeted query result was incomplete and its contrary statement is superseded.
- `inventory_stock_levels.average_unit_cost` and `idx_inventory_stock_company_cost` exist. The migration's historical cost backfill and current valuation correctness have **not** been certified by this catalog check.
- `company_invitations` and its pending-email unique index exist; `user_mfa` exists.
- `subscription_payments`, `auth_rate_limits`, `auth_refresh_tokens`, and `mpesa_stk_requests` exist with several expected indexes.
- The tax snapshot migration remains materially incomplete in the inspected schema: `tax_treatment` was absent from `invoice_items`, `quotation_items`, and `supplier_bill_items`; `credit_note_items.invoice_item_id` and `credit_note_items.tax_treatment` were also absent. Their tax-treatment check constraints were not found.
- `supplier_bills.supplier_invoice_number` exists, but `supplier_bills_supplier_invoice_number_unique` remains absent. The duplicate preflight must be repeated immediately before any future index attempt.
- RLS is enabled on the attendance/assignment/import and POS tables listed above, with zero policies. The inspection also reconfirmed 55 public tables with RLS enabled and zero policies. Do not treat this as tenant isolation: no policy or role changes were made.
- Definition mismatches need review, not automatic replay: for example, the current `employee_assignments` employee foreign key uses `ON DELETE CASCADE`, while migration `024_workforce_attendance_assignments.sql` specifies `ON DELETE RESTRICT`; the current attendance employee foreign key also differs from that migration's declared delete behavior. This is evidence that object-existence checks alone are insufficient.

### Migration-by-migration working classification

These are provisional triage labels from the catalog reads, not final “applied” decisions:

| Missing ledger filename(s) | Current observation | Required next action |
|---|---|---|
| `024_workforce_attendance_assignments.sql` | Tables/indexes exist; RLS enabled without policies; foreign-key delete behavior differs from file | Full constraint/policy/grant diff on isolated clone; review delete semantics |
| `025_monthly_attendance_import.sql` | National-ID column/index and import tables exist; RLS enabled without policies | Full DDL and data-conflict diff; review uniqueness and RLS |
| `030_pos_registers_and_shifts.sql` | Register/shift tables exist; two expected open-shift uniqueness indexes not found | Verify equivalent constraints and concurrent shift invariants |
| `031_pos_checkout.sql` | POS sales, shift linkage, composite constraints, and request-id index exist | Compare every constraint and confirm request IDs are non-null/unique without changing rows |
| `032_inventory_weighted_average_cost.sql` | Cost column and index exist | Verify backfill/value invariants on clone; finance owner must approve valuation changes |
| `034_company_invitations.sql` | Invitation table and pending-email index exist | Compare full FK/unique/index definitions and confirm invite state invariants |
| `035_user_mfa.sql` | MFA table and recovery/failure-state columns exist | Compare all columns/checks and MFA data invariants |
| `037_credit_note_staff_read.sql` | Permission seed effects not yet conclusively checked in this pass | Read-only compare role-permission rows; no permission edits |
| `040_product_image_url.sql` | Image URL column exists | Verify type/default/index parity; no repair indicated by column presence alone |
| `046_subscription_paystack_payments.sql` | Payment table and pending index exist | Compare constraints/indexes and payment-reference invariants |
| `047_auth_rate_limits.sql` | Rate-limit table and update-time index exist | Compare primary key, checks, and cleanup behavior |
| `048_auth_refresh_tokens.sql` | Refresh-token table and family index exist | Compare all token uniqueness/FK/index definitions and revocation invariants |
| `20261018000000_product_image_storage.sql`, `2026101801_add_product_image_columns.sql` | Both image columns and storage-key index exist | Compare exact index/column definitions; avoid replaying overlapping ALTERs blindly |
| `202610210001_mpesa_stk_push.sql` | STK request table and expected company-created index exist | Compare all remaining indexes/FKs and callback/reconciliation invariants |
| `202610260003_transaction_tax_snapshots.sql` | Required tax-treatment columns and checks are absent on the inspected tables | Prepare a forward-only repair after legacy-value, dependency, and credit-note-line review |
| `202610260005_supplier_invoice_number_uniqueness.sql` | Required unique index absent | Repeat duplicate preflight on clone and immediately before any approved execution |
| `202610260006_credit_note_invoice_line_links.sql` | Required original-invoice-line and tax snapshot columns/check are absent | Inspect existing credit-note lines and design safe forward repair; do not rewrite historical amounts |

### Remaining evidence gaps

1. Complete catalog comparison for every object in all 18 files, including role grants, policies, triggers, functions, and any data transformation.
2. Check role-permission effects for migration 037.
3. Validate all classifications on a disposable PostgreSQL/Neon clone with the exact shared schema/ledger drift reproduced.
4. Establish a verified backup and restore rehearsal before considering any shared development repair.
5. Verify the actual Render runtime database role separately; do not infer it from the inspection role.
6. Test tenant isolation with a non-owner, non-`BYPASSRLS` role and explicit policies on an isolated clone. The current schema state is not acceptable as a completed RLS implementation.

## Acceptance criteria

- A schema/ledger diff explains every missing migration and every partially applied object.
- The isolated clone successfully rehearses the exact forward-repair bundle and verification queries.
- No unexplained ledger gaps or schema drift remain after the approved repair.
- Clean-install, upgrade, idempotency, tenant-isolation, finance, stock, and critical workflow tests pass.
- Backup/restore and recovery instructions are proven, not merely documented.


## Follow-up catalog verification — 2026-10-30

All checks below were read-only against the same development database; no DDL or row changes were made.

- Current validation run [40909097738](https://github.com/pestria72-code/Omega-Solutions/actions/runs/40909097738) completed successfully on development HEAD `85bf9d094a4efe8f9d916b830628462c9263f34a`: API build/tests/lint, purchase-order approval regression, frontend build, and dependency-audit reporting all passed.
- A broader `pg_indexes` catalog result confirms both POS one-open-shift partial unique indexes are present and match the predicates/keys declared by migration 030. This corrects the earlier 2026-10-29 statement that they were absent. Do not create or replay them.
- The following expected tax/credit-note columns remain absent: `invoice_items.tax_treatment`, `quotation_items.tax_treatment`, `supplier_bill_items.tax_treatment`, `credit_note_items.invoice_item_id`, and `credit_note_items.tax_treatment`. The corresponding migration 202610260003 and 202610260006 checks/definitions therefore remain an actionable schema gap.
- `supplier_bills.supplier_invoice_number` remains present, but the partial expression unique index `supplier_bills_supplier_invoice_number_unique` remains absent. The application advisory-lock mitigation does not replace the database constraint. No duplicate preflight or index creation was performed in this follow-up.
- The full catalog result was large and truncated by the inspection interface; it is useful for object discovery but is not a retained schema-only dump and does not complete the required exact definition comparison. Constraints, triggers, functions, grants, RLS policies, ownership, and data invariants still require a complete isolated-clone diff.
- The inspection connection remains `neondb_owner` with `BYPASSRLS`; Render runtime identity is still unverified. The finding of zero RLS policies remains a release blocker.

**Current classification adjustment:** migration 030's two one-open-shift indexes are present; do not classify those indexes as missing. Migration 024 remains definition-mismatched because the live employee foreign-key delete actions differ from the migration's `ON DELETE RESTRICT`. The migration ledger still has 18 missing filenames; no ledger rows were inserted.


## Focused migration-definition review — 2026-10-30

Read-only review of repository migration SQL against live catalog evidence:

### Migration 024 — workforce assignments and attendance

- Repository SQL explicitly declares `employee_assignments(employee_id, company_id) -> employees(id, company_id) ON DELETE RESTRICT` and `attendance_records(employee_id, company_id) -> employees(id, company_id) ON DELETE RESTRICT`.
- Live catalog instead reports both composite employee foreign keys with `ON DELETE CASCADE`. This is a confirmed definition mismatch, not merely an assumption from table existence.
- Live `employee_assignments(site_id, company_id)` and `attendance_records(assignment_id, company_id)` use `ON DELETE RESTRICT`, matching the migration.
- Do not “fix” the live constraints directly. First establish whether cascade behaviour is relied on by existing workflows and inspect dependent rows on a disposable clone; then produce a reviewed forward-only migration if needed.

### Migration 202610260003 — transaction tax snapshots

- Migration adds `tax_treatment` as NOT NULL DEFAULT `legacy` to invoice, quotation, and supplier-bill line tables, plus named CHECK constraints and column comments.
- Live catalog still lacks all three columns. Exact remediation must verify defaults, nullability, constraints, comments, and application write/read paths on an isolated clone before any shared migration.

### Migration 202610260005 — supplier invoice uniqueness

- Migration's preflight groups non-void bills by company, supplier, and normalized invoice number (`LOWER(BTRIM(...))`), then creates a partial unique expression index.
- A read-only duplicate preflight on 2026-10-30 returned zero duplicate groups for the current development data. This is a point-in-time observation only; rerun the exact preflight immediately before any future index creation because concurrent writes can introduce duplicates.
- The required index remains absent in the live catalog. No index was created.

### Migration 202610260006 — credit-note invoice-line link

- Migration adds nullable `invoice_item_id UUID`, `tax_treatment NOT NULL DEFAULT 'legacy'`, a CHECK constraint, and a lookup index.
- **Definition review finding:** the migration does not declare a foreign key from `credit_note_items.invoice_item_id` to `invoice_items.id`, nor a composite company-scoped foreign key. Its comment says the line references an original invoice line, but the DDL itself does not enforce referential or same-company integrity. This should be reviewed as a migration design gap before applying it; do not silently alter historical migration files. A new forward migration should be designed after checking key uniqueness and service-level transaction validation.
- Both columns remain absent from the live schema.

No schema, ledger, or business rows were changed. This is not authorization to apply migrations.


## Credit-note application-path review — 2026-10-30

Read-only review of `api/src/credit-notes/credit-notes.controller.ts`, `credit-notes.service.ts`, DTOs, service specs, and migration `202610260006_credit_note_invoice_line_links.sql`. No source code or database objects/rows were changed.

### Controls confirmed in the current service

- Controller requires JWT authentication, `credit-notes:read/write` permissions, and the `sales` module entitlement.
- Company context is resolved from the authenticated membership. Credit-note list/detail, invoice selection, invoice-line selection, item reads, refund balances, and writes are scoped by company ID.
- Creation loads the invoice with `WHERE id=$1 AND company_id=$2 FOR UPDATE`, checks branch access for branch-bound users, and rejects draft/cancelled invoices.
- Original lines are selected using both `company_id` and `invoice_id`; the requested line IDs must all resolve. Thus the service-level create path rejects a line belonging to another invoice or company.
- Unit price, tax rate, and tax treatment are taken from the selected original invoice line, not accepted from the request. Requested quantity is checked against previously credited quantity and remaining line value.
- Invoice-row locking serializes concurrent credit-note creation against the same invoice. The credit-note insert, item inserts, journal, customer-credit balance, invoice credited amount, and customer receivable update are in one database transaction.
- Refund creation locks the customer-credit balance row and checks the remaining refundable amount before inserting the refund and journal.
- DTO validation requires UUID references, a positive quantity, bounded text, and at least one item. The service additionally rejects duplicate original-line IDs in one note.

### Confirmed integrity gap: historical credits are not accounted for by the new line-level cap

The line-cap query sums prior `credit_note_items` only where `cni.invoice_item_id=$3`. Migration 202610260006 adds that column as nullable, and the current migration contains no historical backfill. Existing credit-note lines therefore remain unlinked unless separately reconciled. Their quantities and values are invisible to the new per-invoice-line cap. After the migration is applied, a new credit against a previously credited invoice line could exceed the true remaining quantity/value if an earlier credit note for that line has a NULL link.

This is not evidence that a current shared-database write is possible: the inspected live schema still lacks the column, so the current service's insert/select statements also depend on the missing migration. It is a forward-migration/backfill acceptance blocker. Before enabling this code path, define a deterministic historical matching strategy using invoice, company, and line attributes; classify ambiguous/unmatchable historical lines; and refuse credit issuance for affected invoices until reconciled or safely handled. Do not guess links or alter historical amounts.

### Database constraint design gap remains

Migration 202610260006 declares no FK for `invoice_item_id`, and no composite company-scoped FK. The service checks ownership for new creates, but the database would not prevent invalid references introduced by another writer, a future code path, or direct SQL. Design a forward-only constraint after confirming referenced key uniqueness and handling historical NULL/unmatched rows. Preserve tenant scoping in the constraint (or equivalent DB-enforced invariant), not only in application queries.

### Test coverage gaps

Existing service specs cover company-scoped listing, over-quantity rejection, duplicate line references, branch restriction, paid-invoice customer-credit treatment, tax journal balancing, and refund limits. The reviewed specs do not explicitly test:
- rejecting an invoice line from a different invoice;
- rejecting an invoice line from another company;
- historical unlinked credit-note lines being included in remaining-quantity/value calculations;
- concurrent credit attempts against the same invoice;
- DB-level rejection of a cross-company or nonexistent invoice-line reference.

Add isolated tests for these cases before marking the credit-note integrity work complete. The service's invoice-row lock is a sound serialization mechanism for this path, but a concurrency regression test should verify it against PostgreSQL rather than mocks alone.

**Disposition:** application-level tenant/ownership validation for new credit-note creation is present in the inspected code. The unresolved blockers are historical credit reconciliation, database-enforced referential/company integrity, missing live migration effects, and targeted regression coverage. No fix or migration was applied.


## Tax transaction-path review — 2026-10-30

Read-only review of the tax policy resolver, invoice/quotation/purchase-order/supplier-bill/credit-note services, DTOs, selected types/specs, and tax migrations. No source code or database objects/rows were changed.

### Confirmed controls

- `readCompanyTaxPolicy` fails closed for malformed non-empty settings and malformed configured policies. A VAT-registered configured company must supply a valid standard rate.
- In configured mode, invoice and quotation creation load each product within the current company, use the product's persisted tax treatment/rate, reject legacy/unclassified products, reject standard-rated sales for non-VAT-registered companies, and require standard product rates to match the company standard rate.
- Invoice and quotation line calculations use integer cents and round line tax to cents. Their inserts persist the resolved `tax_treatment`, `tax_rate`, subtotal, tax and total.
- Purchase-order creation also loads company-owned products and resolves configured tax using the product's persisted treatment/rate. It stores the calculated rate and amounts on purchase-order lines.
- Supplier-bill creation requires a valid treatment enum when supplied and uses the shared resolver. In configured mode, a standard-rated bill line must match the company's standard rate and non-standard treatments calculate zero tax. Supplier-bill lines persist treatment/rate and amounts; bill posting separates input tax from payable in the journal.
- Credit-note creation copies tax rate and tax treatment from the locked original invoice line and computes reversal tax from the original line's unit price and requested credit quantity. Journal entries debit output tax by the calculated credit tax.

### Confirmed read/API omission: tax treatment is not returned for invoice or quotation detail lines

- `InvoicesService.getById` selects invoice line `tax_rate` and amounts but omits `tax_treatment`, even though creation writes it.
- `QuotationsService.getById` likewise omits `tax_treatment`, even though creation writes it.
- The corresponding `InvoiceItemRow` and `QuotationItemRow` types also do not declare `tax_treatment`.
- This prevents API consumers from reliably displaying/auditing the stored tax classification snapshot on invoice and quotation detail responses. Add the column to both detail SELECTs and row types, then test response serialization and UI display. Do not infer treatment from the current product record because product classification may have changed after the transaction.

### Confirmed purchase-order snapshot gap

- Purchase-order creation resolves tax treatment from the product but its in-memory line structure and INSERT persist only `tax_rate` and calculated amounts; `purchase_order_items` does not receive a `tax_treatment` snapshot.
- The purchase-order DTO accepts a client tax-rate override but not a treatment; the resolver correctly applies product treatment/rate at creation. However, once the product changes classification, the purchase-order line cannot independently reveal the exact treatment originally applied.
- Decide whether purchase orders are intended to be immutable tax snapshots. If yes, add a forward migration for `purchase_order_items.tax_treatment`, persist the resolved value, and expose it in detail responses. Backfill historical rows only where treatment can be proven; otherwise mark them explicitly legacy/unknown without recalculating amounts.

### Supplier-bill policy distinction requiring explicit product decision

- Supplier-bill DTO accepts `taxTreatment` and `taxRate` from the authorized bill creator. For configured policy, the resolver validates the standard rate against company policy, but it does not derive supplier input-tax treatment from the purchase-order/product line. This may be intentional because supplier invoice input-tax evidence can differ from the product's sales/output tax classification; document that distinction and require the operator to classify from the supplier tax invoice. If the intended rule is to inherit purchase-order/product treatment, the current flow does not enforce it.
- Existing supplier-bill service tests cover duplicate references and branch restrictions but do not test configured tax-policy behaviour, tax-treatment snapshots, or the input-tax journal for standard/zero-rated/exempt/out-of-scope cases. Add focused tests to pin down the intended supplier-input-tax policy before changing the implementation.

### Test coverage and remaining review

- `tax-policy.spec.ts` covers legacy compatibility, standard-rate matching, VAT-registration requirements, unclassified-product rejection, exempt zero-tax handling, and malformed policies.
- Purchase-order tax specs exist, but invoice/quotation tax-path specs and configured supplier-bill tax-path specs were not found in the reviewed focused spec files.
- Migration 202610260003 adds NOT NULL DEFAULT `legacy` treatment snapshots and CHECK constraints to invoice, quotation and supplier-bill lines; those columns remain absent from the inspected shared development schema. Migration 202610260006 adds the credit-note treatment snapshot, also absent. No migration was run.
- Accounting journals currently post output/input tax using aggregate amounts and the configured tax control accounts. This review did not find a tax-return/VAT-summary report implementation in the inspected accounting service; a separate report/UI search is still needed before certifying end-to-end tax reporting.

**Disposition:** creation-time policy enforcement is present for sales invoices, quotations and purchase orders. The confirmed gaps are missing tax-treatment fields in invoice/quotation detail responses, missing purchase-order treatment snapshots, untested supplier-bill policy semantics, absent live snapshot migration effects, and incomplete tax-report verification. No fixes or migrations were applied.


## Tax reporting and report-screen review — 2026-10-30

Read-only review of the accounting controller/service, dashboard controller/service, their focused specs, and the Vite report, financial-report, and tax-settings screens. No application code or database objects/rows were changed.

### Confirmed report capabilities in the reviewed paths

- `GET /api/accounting/reports/trial-balance` is the only accounting report endpoint declared by the reviewed `AccountingController`. It returns cumulative posted-ledger balances as of a date, including debit/credit totals and balance variance.
- Other accounting endpoints in that controller provide account listing, journals, and AP/AR reconciliation/ageing. They do not return VAT-period totals.
- The default chart of accounts defines separate control accounts for Input VAT Recoverable (`input_tax`) and Output VAT Payable (`output_tax`). Their existence supports journal posting, but does not by itself provide a period tax report.
- The Vite `/financial-reports` page renders the trial balance only. Its own description says additional financial statements will be enabled as controls are completed.
- The Vite `/reports` page fetches the full `/invoices` collection and filters invoice issue dates in the browser. It displays invoice count, invoice total, paid amount and outstanding balance. Its CSV includes each invoice's aggregate `tax_amount`, but the page does not calculate period output VAT, group by tax treatment/rate, include credit-note reversals, or include supplier-bill input VAT.
- The dashboard summary returns invoice revenue trend and overdue invoices, but no tax metrics or VAT return data.
- The tax settings page configures company tax policy; it is not a tax report.

### Confirmed gap: no VAT-period report in the reviewed API/UI

The reviewed accounting controller exposes no VAT/tax report route, and the reviewed report screens expose no VAT return or tax reconciliation view. In particular, there is no reviewed report that reconciles, for a selected tax period:
- output VAT on sales invoices;
- output VAT reversals on credit notes;
- recoverable input VAT from posted supplier bills;
- net VAT payable/receivable;
- breakdown by standard-rated, zero-rated, exempt and out-of-scope treatment, with the relevant taxable bases;
- transaction-level drill-down and reconciliation to the tax control accounts.

The invoice-register CSV's per-invoice `tax_amount` is not a VAT report: it does not distinguish output from input tax, account for credit-note tax reversals, or provide treatment/rate bases. The trial balance is cumulative and cannot replace a tax-period calculation and reconciliation.

### Additional reporting design risks observed

- The invoice report downloads all invoices and applies the date filter client-side. This is not a period-scoped server-side reporting query and may become slow or incomplete as tenant data grows. It also means the UI's period metrics are derived from the downloaded collection, not a dedicated reporting contract.
- The trial-balance service defaults its date in the response using the server's current UTC date when no date is supplied; the UI supplies a browser-local date. Review date/timezone semantics before reusing it for statutory period boundaries.
- The accounting control-account setup has separate input/output VAT accounts, but the inspected report API does not query those accounts by tax period or reconcile them to transaction subledgers.

### Required next work before claiming tax reporting is complete

1. Define the authoritative Kenyan VAT-period reporting rules and period boundaries with the business/accounting owner; do not hard-code rates or assume every company is VAT registered.
2. Design a server-side, company-scoped report contract with explicit period dates, currency, tax treatment/rate bases, output tax, credit-note reversals, input tax, net position, and reconciliation variances.
3. Derive values from immutable transaction snapshots and posted accounting entries; do not infer historical tax treatment from current product settings. Decide how legacy/unclassified rows and unposted/void transactions are presented.
4. Reconcile the report to the output/input tax control accounts and transaction subledgers, and expose drill-down to the underlying invoices, credit notes and supplier bills.
5. Add tests for date boundaries, company isolation, branch/permission/module access, multiple currencies, legacy classifications, rounding, credit-note reversals, supplier input-tax evidence, and ledger/subledger reconciliation.
6. Replace the all-invoices client-side report filter with a paginated/server-side date-scoped endpoint before treating it as a scalable financial reporting path.

**Disposition:** the reviewed code supports trial balance, AP/AR reconciliation and an invoice register, but does not demonstrate a complete VAT-period report. This conclusion is bounded to the inspected accounting/dashboard controllers and services and the three named Vite screens; other report implementations outside those paths would need separate verification. No fixes, migrations, or data changes were made.
