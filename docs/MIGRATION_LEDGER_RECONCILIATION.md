# Development migration-ledger reconciliation plan

**Scope:** Read-only inspection of the shared Neon development database on 2026-10-29. No SQL was executed against the shared database that changes schema or data. This report is not authorization to apply migrations.

## Summary

- Migration files in api/src/migrations/: **66**
- Rows in public.omega_schema_migrations: **48**
- Missing ledger entries: **18**
- Alternate migration ledgers (pgmigrations, schema_migrations): not present.
- The missing entries are interleaved with later applied migrations, so this is not a normal append-only upgrade.
- Several missing migrations' schema objects exist, indicating that some changes were applied outside the current migration runner or their ledger records were lost.
- **Do not run npm run migrate against the shared database.** Missing migration 032_inventory_weighted_average_cost.sql contains a data-changing backfill. The migration runner now refuses catch-up when it finds gaps before later applied migrations or an empty ledger over existing application tables.

## Missing migration inventory

| Missing migration | Read-only evidence | Safe disposition |
|---|---|---|
| 024_workforce_attendance_assignments.sql | client_sites, employee_assignments and attendance_records exist; RLS is enabled; attendance/assignment permissions exist. | Schema appears present; compare all indexes/constraints before recording it as reconciled. |
| 025_monthly_attendance_import.sql | Monthly import tables and employees.national_id exist; attendance permissions exist. | Schema appears present; compare indexes/constraints before reconciling ledger. |
| 030_pos_registers_and_shifts.sql | pos_registers and pos_shifts exist. | Schema appears present; compare constraints/indexes and RLS state. |
| 031_pos_checkout.sql | pos_sales exists; request_id is non-null and its company/request unique index exists; invoice_payments.pos_shift_id exists. | Schema appears present; compare every FK/index before reconciling ledger. |
| 032_inventory_weighted_average_cost.sql | inventory_stock_levels.average_unit_cost and idx_inventory_stock_company_cost exist. The migration also backfills weighted-average costs using historical inbound movements. | **Manual review required.** Do not rerun its data-changing UPDATE or mark it reconciled based on column presence alone. |
| 034_company_invitations.sql | company_invitations exists. | Compare constraints/indexes, then reconcile ledger only with evidence. |
| 035_user_mfa.sql | user_mfa exists. | Compare columns/constraints, then reconcile ledger only with evidence. |
| 037_credit_note_staff_read.sql | credit-notes:read exists and is assigned to staff. | Permission effect appears present; verify exact role mapping before ledger reconciliation. |
| 040_product_image_url.sql | products.image_url exists. | Compare expected column/index state. |
| 046_subscription_paystack_payments.sql | subscription_payments exists. | Compare constraints/indexes before ledger reconciliation. |
| 047_auth_rate_limits.sql | auth_rate_limits exists. | Compare constraints/indexes before ledger reconciliation. |
| 048_auth_refresh_tokens.sql | auth_refresh_tokens exists. | Compare constraints/indexes before ledger reconciliation. |
| 20261018000000_product_image_storage.sql | products.image_storage_key exists. | Compare the expected index and column comments. |
| 2026101801_add_product_image_columns.sql | products.image_url and products.image_storage_key exist. | Compare exact column definitions. |
| 202610210001_mpesa_stk_push.sql | mpesa_stk_requests exists. | Compare constraints/indexes before ledger reconciliation. |
| 202610260003_transaction_tax_snapshots.sql | tax_treatment is absent from invoice_items, quotation_items and supplier_bill_items, although current services insert/query it. | **Release blocker.** Apply a reviewed schema repair only after explicit authorization; validate against a disposable DB first. |
| 202610260005_supplier_invoice_number_uniqueness.sql | supplier_bills_supplier_invoice_number_unique index is absent. A read-only aggregate found 0 duplicate non-void groups / 0 excess rows at inspection time. | **Control gap.** After ledger reconciliation approval, recheck duplicates and create the unique index. |
| 202610260006_credit_note_invoice_line_links.sql | credit_note_items.invoice_item_id and credit_note_items.tax_treatment are absent although current credit-note service queries/inserts them. | **Release blocker.** Apply a reviewed schema repair only after explicit authorization; validate against a disposable DB first. |

## Required reconciliation sequence

1. Keep automatic migrations blocked on the shared development database until the ledger gaps are understood.
2. Take an authorized backup/schema snapshot before any future repair; do not copy or expose business records unnecessarily.
3. Compare each missing migration's full DDL, indexes, constraints, permission effects and data-changing statements with the live schema.
4. Do not mark a migration applied merely because its main table exists. For data-changing migrations, verify the intended backfill separately or leave it for an explicitly approved repair.
5. Prepare a reviewed repair plan for the missing tax snapshots, credit-note line links, and supplier invoice uniqueness constraint.
6. Apply only after explicit authorization, in a controlled window, and verify API paths and tenant isolation after the schema repair.
7. Re-run clean-install, idempotency, migration-gap guard, and upgrade tests in CI.

## CI evidence

- [Clean migration, idempotency, workforce/tax/supplier-index schema assertions, and all ledger safety guards](https://github.com/pestria72-code/Omega-Solutions/actions/runs/40892821358)
- [Production readiness map](https://github.com/pestria72-code/Omega-Solutions/blob/development/docs/PRODUCTION_READINESS_MAP.md)

**No shared database or production data was modified during this audit.**
