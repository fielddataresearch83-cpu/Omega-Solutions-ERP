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

## Acceptance criteria

- A schema/ledger diff explains every missing migration and every partially applied object.
- The isolated clone successfully rehearses the exact forward-repair bundle and verification queries.
- No unexplained ledger gaps or schema drift remain after the approved repair.
- Clean-install, upgrade, idempotency, tenant-isolation, finance, stock, and critical workflow tests pass.
- Backup/restore and recovery instructions are proven, not merely documented.
