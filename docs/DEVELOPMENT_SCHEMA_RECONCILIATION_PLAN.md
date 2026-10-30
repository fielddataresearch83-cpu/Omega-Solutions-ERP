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


## Follow-up reporting API contract review — 2026-10-30

Read-only review of `InvoicesController`, `InvoicesService.list/getById`, `SupplierBillsController`, `SupplierBillsService.list/getById`, and the report pages. No source code or database changes were made.

### Confirmed scale and completeness issue in invoice register

- `GET /api/invoices` accepts only optional `search` and `status`; there are no date, page, limit, cursor, or sort parameters in the controller/service contract reviewed.
- `InvoicesService.list` applies company and branch scoping and optional search/status filters, but has no SQL `LIMIT`, pagination, or date predicate. It returns every matching invoice row, including item-count aggregation.
- The Vite invoice report calls this endpoint once and filters `issue_date` in the browser. Therefore the report's selected date range does not constrain database retrieval; all invoices visible to that membership are loaded first.
- This is a confirmed unbounded-list contract, not proof of a currently observed outage. At scale it increases query, network, memory, and browser processing costs and can make report loading unreliable. Add a dedicated server-side date-range report endpoint with validated date bounds, stable ordering, pagination/streamed export, and company/branch/permission/module enforcement. Do not silently change the semantics of the operational invoice list without checking its other consumers.

### Supplier-bill reporting data availability

- `GET /api/supplier-bills` is company-wide and blocked for branch-bound memberships. Its list query returns aggregate bill fields including bill date, subtotal, tax amount, total, paid amount, status and item count; it has no date filters or pagination.
- Supplier-bill detail returns item rows including tax-rate/treatment snapshots. This gives a potential source for an input-tax drill-down, but the list endpoint alone cannot provide treatment/rate bases.
- The supplier-bill service posts input-tax journal debits when creating a bill, but the reviewed reconciliation endpoint compares accounts-payable control balance with bill balances only. There is no equivalent input-tax subledger reconciliation in the reviewed accounting API.

### Date semantics requiring attention

- AP/AR reconciliation computes ageing relative to PostgreSQL `CURRENT_DATE` and labels the result with a UTC-derived application date. The reviewed routes do not accept an explicit as-of date, so these are current snapshots rather than reproducible historical ageing reports.
- Trial balance accepts an explicit date and filters posted journal entries by `entry_date`, but its default date label is derived from the application server's UTC date. A future period-reporting contract should use explicit inclusive/exclusive date boundaries and a single documented business timezone.

**Disposition:** the invoice and supplier-bill list APIs are not paginated or period-filtered in the reviewed implementation. This strengthens the recommendation for dedicated server-side reporting contracts. The supplier-bill records and journals provide source data for input VAT, but no input-tax subledger reconciliation was found in the reviewed accounting routes. No fixes or migrations were applied.


## Accounting and inventory lifecycle integrity review — 2026-10-30

Read-only review of the accounting service, inventory service and focused specs, invoice status/payment paths, POS checkout and POS specs, and invoice stock-reversal spec. No application source, schema, business data, or production services were changed.

### Confirmed positive controls

- Invoice send/cancel and payment confirmation use database transactions. Invoice status/payment paths lock the invoice row before applying their related ledger and customer-balance updates.
- POS checkout uses a request-key advisory transaction lock and returns the existing sale for a retry by the same cashier. Stock issue, invoice/item creation, sale record, sales/COGS journals, payment records and customer balance updates occur inside the checkout transaction.
- POS checkout uses the selected warehouse's weighted-average cost for both stock issue and COGS; the same transaction writes stock movement and stock-level changes.
- Manual inventory receipt/issue/adjustment updates stock level, movement history, legacy product quantity and (for non-zero cost) the inventory adjustment journal within one transaction.
- Stock transfers lock both warehouse/product rows in sorted warehouse-ID order, update both stock levels, write paired movements under one transfer group, and synchronize legacy product quantity in one transaction. No net inventory journal is expected for a same-company warehouse transfer.
- Accounting AP/AR reconciliation runs its control-account, subledger and ageing reads in a read-only REPEATABLE READ transaction, reducing inconsistent cross-query snapshots.

### Confirmed reporting/reconciliation consistency gap

- Inventory `reconciliation()` runs its stock-vs-movement, legacy product quantity, and valuation-vs-inventory-control queries through three independent `db.query` calls in `Promise.all`, not one repeatable-read snapshot.
- Concurrent receipts, issues, transfers, POS checkouts, adjustments or journal postings can occur between those queries. The returned combined report can therefore compare different database states and show a transient false mismatch (or miss a mismatch that is corrected between reads).
- The focused inventory spec verifies the three comparisons and that they are read-only, but does not verify a consistent snapshot under concurrent writes.

**Recommended:** execute the three reconciliation queries in one `REPEATABLE READ READ ONLY` transaction, as the accounting reconciliations already do. Add a test asserting the isolation statement and that all three queries use the same transaction client.

### Confirmed lifecycle test-coverage gaps

- `invoices.stock.spec.ts` contains one focused test proving cancellation restores a POS sale to the checkout warehouse and uses the stored issue cost. It does not exercise the full status-cancellation transaction, journal reversal, customer balance update, rollback on a failed journal, or repeated cancellation.
- POS specs cover idempotent retry and COGS journal-line construction, but the reviewed focused tests do not demonstrate an end-to-end transaction rollback across stock, invoice, POS sale, journals, payments and customer balances.
- Inventory specs cover paired transfer movement writes, row locking and quantity checks, and the read-only reconciliation query shapes. They do not provide PostgreSQL-backed concurrency tests for competing issue/transfer/adjustment requests or failure injection after each stage to prove atomic rollback.
- Accounting service specs cover AP/AR reconciliation outputs and account seeding; the reviewed tests do not comprehensively assert ledger balance invariants across invoice, payment, credit-note, supplier-bill and stock lifecycles.

### Scope limitation

The code paths inspected show several well-structured transactional safeguards, but mocked unit tests do not prove PostgreSQL locking behavior, isolation, rollback semantics, trigger/constraint enforcement, or deployed database compatibility. No live business-data transaction tests were run. Treat these as code-review findings, not a production accounting certification.

**Disposition:** no definite unbalanced journal or tenant-crossing defect was established in this pass. The concrete new issue is that inventory reconciliation does not use a consistent database snapshot. The principal remaining risk is insufficient PostgreSQL-backed lifecycle/concurrency/rollback evidence across the integrated workflows.


## Invoice payment, cancellation and audit-atomicity review — 2026-10-30

Read-only review of `InvoicesService` payment report/confirm/reject/reconcile and status transitions, `SupplierBillsService.recordPayment`, `CreditNotesService.recordRefund`, POS checkout/shift close, and `AuditService.log`. No application code, schema, business data, or production services were changed.

### Confirmed financial lifecycle safeguards

- Invoice payment reporting locks the company-scoped invoice row, totals existing pending reports, and rejects a new report that would exceed the remaining amount after confirmed payments and credits.
- Payment confirmation locks the invoice first and then the company/invoice-scoped payment row. It only accepts pending reports, rechecks the remaining invoice balance, creates a balanced receipt journal, marks the payment confirmed, updates invoice paid amount/status, updates any linked POS sale, and reduces customer outstanding balance in one database transaction.
- Payment rejection only transitions pending reports. Reconciliation only transitions confirmed reports and requires a non-empty statement reference; neither transition posts a second receipt journal.
- Invoice cancellation locks the invoice, refuses paid/partially-paid invoices, refuses invoices with issued credit notes, and refuses any non-rejected payment report. For eligible sent/overdue invoices, stock restoration, COGS reversal, sales/tax/receivable reversal, customer-balance adjustment and invoice status update are in one transaction.
- Supplier-bill payment locks the bill row, checks the outstanding amount under that lock, inserts the payment, posts the AP/cash-or-bank journal, and updates paid amount/status in one transaction. This serializes concurrent payments against the same bill.
- Credit-note refunds lock the customer-credit balance and check remaining refundable value before recording a refund and balanced journal (previous review).

### Confirmed audit atomicity gap affecting financial operations

- The reviewed invoice payment report, payment confirmation, payment rejection, payment reconciliation, invoice status transition, supplier-bill payment, credit-note refund and POS checkout paths call `audit.log` after their financial database transaction has committed.
- `AuditService.log` inserts the audit row using a separate `db.query`, catches database errors only to log them, and then rethrows the error.
- Therefore, if the audit insert fails after a successful financial commit, the API request can return an error even though the payment/status/checkout/refund has persisted. The user may reasonably retry an action that already happened. For payment confirmation, a retry then fails because the payment is no longer pending; for non-idempotent payment reporting, a retry can create another pending report if remaining balance permits. The audit record is also absent for the committed operation.
- POS checkout has a request-key idempotency path that can return the prior sale on retry, but that does not remove the missing-audit-record problem. Other reviewed invoice actions do not expose equivalent general request idempotency keys.
- This is an application-level consistency issue between the financial transaction and its required audit trail; it is not a journal imbalance finding.

**Recommended:** write the audit event in the same database transaction/client as the financial mutation, so both commit or roll back together. If audit delivery must be asynchronous, use a transactional outbox written in the financial transaction and a retryable dispatcher with unique event identity; do not silently swallow audit failures. Add failure-injection tests proving that an audit insert failure cannot leave an unaudited committed financial mutation, and idempotency tests for retry after ambiguous network/database failures.

### Scope and disposition

- The code reviewed contains meaningful invoice-first row locking, balance rechecks, transaction grouping and balanced journal construction. No definite duplicate journal or overpayment race was established in these inspected paths.
- Mocked tests and source review do not prove PostgreSQL concurrency/rollback behavior. No live financial transactions were executed.
- No code fixes or database changes were applied. The new confirmed finding is audit/financial-transaction atomicity and ambiguous retry behavior.


## Cross-module audit-log atomicity expansion — 2026-10-30

Follow-up read-only scan of service-layer `audit.log` call sites in approvals, contracts, expenses, manufacturing, purchase orders, requisitions, workforce, inventory, products, customers, suppliers, branches, and user-role management. Reviewed representative surrounding transaction code. No application code, schema, business data, or production services were changed.

### Scope expanded beyond finance

The same commit-then-audit pattern is present in additional state-changing workflows:

- **Approvals:** purchase-order/contract submission and approval decisions update approval/entity state inside a transaction, then write audit events separately.
- **Contracts:** create/update, submit, activate/suspend, contract-to-requisition creation and obligation changes are followed by a separate audit insert. Obligation create/status operations also use standalone DB mutations before audit.
- **Manufacturing:** BOM and production-order creation, order start, production costs, completion and cancellation write operational/stock/journal changes transactionally, then audit separately.
- **Purchase orders and requisitions:** creation, status changes, goods receipt and approval submission are followed by separate audit writes.
- **Workforce:** assignment creation/transfer, attendance import/approval and clock punches are committed before their audit event. Some single-statement mutations are also followed by a separate audit write.
- **Inventory:** warehouse create/update and stock movement audit helper use separate audit writes after the underlying operation. Stock movement callers perform their inventory transaction before calling the helper.
- **Expenses:** expense and journal creation are transactional, then audit is written separately.
- **Products, customers, suppliers, branches and membership role changes:** mutations complete before audit insertion; several of these are simple single-query writes rather than multi-step transactions.

### Impact classification

- The confirmed failure mode is broad: if the audit table insert fails after a successful state change, the API can report failure while the operation persists and its audit event is missing.
- Financial, stock, production and approval actions are highest priority because a retry or mistaken belief that the operation failed can cause duplicate or inconsistent downstream work.
- Master-data CRUD also has the ambiguous-success/missing-audit problem, but generally lower immediate financial impact.
- Image storage workflows require special handling: object-storage side effects cannot participate in a PostgreSQL transaction. Keep database audit/outbox atomic with metadata changes and use a compensating cleanup/retry process for object upload/delete.

### Remediation design recommendation

Adopt one shared transaction-aware audit API, e.g. `audit.log(client, entry)`, which writes through the caller's existing `PoolClient`. Require state-changing service methods to include the audit insert before committing their existing transaction. For single-statement mutations, use a transaction or a data-modifying CTE that atomically writes both mutation and audit row. Avoid a global fire-and-forget logger or swallowing audit errors.

Where an external side effect is involved, persist an outbox event in the same DB transaction and let a worker retry delivery/cleanup. Define stable event IDs and unique constraints for deduplication. Preserve actor, company, branch, entity, action, old/new values and request correlation metadata.

Before rollout, inventory every `audit.log` call site (including controllers, guards, background jobs and integrations), update service tests, and add PostgreSQL-backed failure-injection tests proving:
1. audit insert failure rolls back the associated database mutation;
2. successful mutation and audit row commit together;
3. client retry after ambiguous connection failure does not duplicate a financial/stock/approval action;
4. external object-storage failures are recoverable without orphaned or prematurely deleted objects.

**Disposition:** this scan confirms the audit atomicity issue is systemic, not limited to invoice/payment paths. It does not establish that every call site has identical business impact; the remediation must be prioritized by criticality and transaction shape. No fixes were applied.


## Audit mechanism and schema design review — 2026-10-30

Read-only inspection of `api/src/audit/audit.service.ts`, its unit spec, `api/src/database.service.ts`, the audit module/controller, baseline migration `api/src/migrations/004_audit_logs.sql`, core schema and approval migration.

### Confirmed implementation facts

- `AuditService.log(entry)` calls `DatabaseService.query()`. That method uses `Pool.query`, so the audit insert obtains an independent pooled connection and cannot join the caller's transaction.
- The audit service has no optional `PoolClient` / transaction executor argument and no transaction-scoped write method.
- `DatabaseService.transaction(callback)` already provides a checked-out `PoolClient` to its callback. This is the natural integration point; no second transaction abstraction is needed.
- The audit unit spec verifies company/branch filtering for reads and verifies that a failed audit insert is rethrown. It does not test a business mutation and audit insert in one transaction, rollback on audit failure, PostgreSQL transaction behavior, or duplicate retry handling.
- The baseline audit migration creates `audit_logs` with nullable actor/company/branch/entity IDs, action/entity strings, JSONB old/new values, IP address and timestamp. It adds indexes for user, company, entity and timestamp.
- The migration comment calls the table append-only, but this migration creates no trigger or constraint preventing UPDATE/DELETE. This is a documented intention, not proof of database-enforced immutability. Effective runtime role grants and any later trigger/grant changes require catalog inspection under the actual Render runtime role before making a security claim.
- The audit list endpoint requires `audit:read`, scopes by company and optionally branch, and caps reads at 200 rows. The baseline permissions seed grants audit read to owner/admin and manager, not ordinary staff/viewer.

### Design implications and proposed API

Use a transaction executor contract that accepts either the existing `PoolClient` or a narrowly typed query interface, and make the transactional form explicit (for example `logInTransaction(client, entry)`). Keeping a separate non-transactional method for genuinely standalone events should be deliberate and limited; state-changing business services must use the transaction-scoped method before commit.

A safe rollout should be staged:
1. Add the transaction-scoped audit writer and unit tests without changing callers.
2. Migrate the highest-risk operations first: payments/refunds, invoice cancellation, POS checkout/shift close, inventory movements/transfers, goods receipts, manufacturing completion, supplier-bill posting, payroll/remittance state changes, and approval decisions.
3. Migrate remaining operational and master-data mutations.
4. Add PostgreSQL-backed integration tests that inject audit insert failure inside the same transaction and assert both mutation and audit row roll back. Add success tests proving both commit.
5. Add explicit request idempotency or durable operation keys to non-idempotent externally retriable commands. Atomic audit does not itself make the business operation idempotent.
6. Only after verifying the actual runtime database role, enforce append-only audit behavior with least-privilege grants and/or a narrowly scoped trigger. Preserve an audited, controlled retention/legal process rather than granting application code arbitrary UPDATE/DELETE.

### Schema gaps to consider (not yet proposed as an immediate migration)

- `audit_logs` has no request/correlation ID, idempotency key, source/system actor type, or event schema version. These fields would improve tracing and support deduplication, but should be designed against actual request middleware, background jobs and integration event IDs rather than added speculatively.
- `user_id`, `company_id` and `branch_id` are nullable and use `ON DELETE SET NULL`; this preserves audit rows but can reduce direct attribution after entity deletion. Do not make them NOT NULL without an explicit system-actor and retention design.
- The generic `entity_id` is VARCHAR(100), not a foreign key. This is flexible for polymorphic records, but integrity must come from the transaction and application contract.
- No unique event identity is defined. If an outbox is selected for external delivery, give the outbox event a stable UUID and unique deduplication key; do not assume the current audit table can deduplicate retries.
- Do not add RLS policies or change DB roles as part of this application fix without isolated rehearsal and explicit approval. Existing tenant scoping in the audit list is application-level.

**Disposition:** transaction-aware audit writes can reuse the existing `DatabaseService.transaction` client. The key change is to the audit service contract and its callers, not a wholesale rewrite of the database layer. No application code, migration, schema, business data or production service was changed in this review.


## High-risk caller transaction mapping — 2026-10-30

Follow-up source review of invoice, inventory, POS, supplier-bill and manufacturing services and their focused specs. This narrows the first implementation tranche to existing transaction boundaries; no source changes were made.

| Workflow | Existing DB transaction | Audit currently outside it | Retry / test observations |
|---|---|---|---|
| Invoice creation | Yes; customer/product validation, invoice and item inserts, stock/ledger work | `invoice.create` after commit | No evidence in reviewed path of a general request idempotency key |
| Invoice payment report | Yes; locks invoice and inserts pending payment report | `invoice.payment.report` after commit | Retrying an ambiguous successful request can create another pending report while remaining balance permits |
| Invoice payment confirmation | Yes; locks invoice/payment, posts receipt journal, updates invoice/payment/sale/customer balance | `invoice.payment.confirm` after commit | A retry sees non-pending payment; caller can receive error after successful commit |
| Invoice payment reject/reconcile | Yes; guarded payment status transition | Audit after commit | No duplicate journal expected from these status-only transitions; audit can still be missing |
| Invoice status update/cancel | Yes; locks and mutates invoice and reverses linked stock/ledger where applicable | Status audit after commit | Cancellation has business preconditions; audit failure leaves completed cancellation with error response |
| Inventory adjust/transfer/receipt/issue | Yes; stock levels, movement rows, weighted-average cost and journal where applicable | Movement audit helper after commit | No operation-level idempotency key identified in reviewed method signatures |
| POS checkout | Yes; advisory lock on request ID and sale/stock/invoice/journal/payment writes | Audit after commit | Checkout already has request-key idempotency; retry returns existing sale, but missing audit event remains |
| POS shift open/close | Yes; shift/register state changes | Audit after commit | No audit-in-transaction behavior in reviewed paths |
| Supplier-bill create/payment | Yes; bill/items/postings and payment/AP/cash journal | Audit after commit | Payment row lock protects outstanding amount; request idempotency not established |
| Manufacturing BOM/order create, start, costs, complete, cancel | Yes; operational/stock/journal work where applicable | Audit after commit | No general idempotency key identified in reviewed method signatures |

### First implementation tranche (proposal only)

1. Extend `AuditService` with an explicit `logInTransaction(client, entry)` method. It must issue the same parameterized INSERT through the supplied client and must not catch-and-continue; errors must escape to the caller and roll back the transaction.
2. Add focused unit tests for the SQL/parameters and error propagation, plus a database integration test that runs a sample mutation and audit insert through one `DatabaseService.transaction` and injects an audit insert failure.
3. Migrate invoice payment report/confirmation and invoice cancellation/status changes; inventory movement/transfer/adjustment; POS checkout and shift open/close; supplier-bill payment; manufacturing completion/cancellation. Keep existing business locks and operation order.
4. Add stable idempotency keys to non-idempotent externally retriable commands as a separate contract change, with unique company-scoped operation records. Do not reuse POS checkout's request key without verifying its scope, retention and caller contract.
5. Verify that the tests run against PostgreSQL, not only mocked `PoolClient` objects. Existing service specs are largely mock-based and the reviewed specs do not establish atomic rollback under an actual database failure.

**Important boundary:** this mapping confirms source-level transaction placement, not live database concurrency behavior. It is a migration plan, not authorization to modify application code or database schema. No fixes, commits to application code, migrations, DB writes or deployments were performed.


## Transaction-aware audit writer — implementation checkpoint (2026-10-30)

Implemented on the existing `development` branch:

- `AuditService.logInTransaction(client, entry)` writes the audit row using the caller's `PoolClient`; insert failures are logged and rethrown. The existing standalone `log(entry)` remains for deliberate standalone events.
- Migrated invoice create, payment report, payment confirm/reject/reconcile and invoice status transitions to write their audit rows before the enclosing transaction commits.
- Migrated inventory stock adjustment, transfer, receipt and issue audit events into their stock/ledger transactions.
- Migrated POS checkout, shift open and shift close audit events into their transactions. The existing checkout request-key early-return path still returns the original sale without writing a duplicate checkout event.
- Migrated supplier-bill payment and manufacturing production completion/cancellation audit events into their existing transactions.
- Updated focused service mocks/assertions and added AuditService tests for use of the supplied transaction client and propagation of insert failures.

Validation on commit `293f8d52b12986d07e6e5ac277443a365e8b3cee`:
- API build/tests/lint workflow: passed.
- Full validation workflow: passed, including API tests, development API health/database smoke check, and frontend build.
- Clean disposable PostgreSQL migration/idempotency smoke workflow: passed.

**Not yet completed:** a dedicated PostgreSQL integration test that injects an audit INSERT failure into a real business transaction and proves both business and audit writes roll back. Current tests verify the transaction writer's client usage and error propagation; CI's clean-PostgreSQL migration smoke is not that failure-injection test. Remaining standalone audit call sites (for example warehouse/master-data, register/assignment, supplier-bill creation and other manufacturing create/start/cost events) have not yet been migrated. No database schema/data, runtime DB role/grants, or production service was changed; no deployment was performed.
