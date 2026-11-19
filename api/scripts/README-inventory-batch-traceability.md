# Inventory batch / lot traceability foundation

Migration: `202611180002_inventory_batch_traceability.sql`

## Scope
- Adds company-scoped inventory batches with expiry, quality status, available/reserved quantities, source references and unit cost.
- Adds movement-to-batch allocations. One movement can allocate across multiple lots (including FEFO splits).
- Backfills one `legacy_snapshot` batch for each positive aggregate stock row. It copies current quantity, reserved quantity and average unit cost; it does not change aggregate stock or create a stock movement.
- Enables tenant RLS using the same `app.company_id`, `app.user_id`, and active-membership policy as existing inventory tables.

## Deliberate limitations
- Historical stock movements cannot be assigned to historical lots because the source schema did not record lot identity. They remain unallocated; do not invent provenance.
- Batch allocations must be written in the same database transaction as the corresponding stock movement and aggregate stock update. The service must validate that allocation totals equal the absolute movement quantity and that allocations never exceed the lot's unreserved quantity (for issues) or increase stock without an authorised receipt/production flow.
- Existing aggregate balances remain the financial/system-of-record quantity until all inventory mutation paths are upgraded and reconciled to batch totals. Do not switch availability or costing to batches yet.
- Do not use a legacy snapshot lot as proof of a real manufacturer batch or expiry date. Its quality is marked released only to preserve already-available legacy stock; its source is explicitly labelled.
- The migration is additive and has not been applied to any database. Validate first on an isolated disposable development database, then compare aggregate stock totals and costs before enabling batch-aware writes.

## Required follow-on implementation
1. Update receipts, issues, transfers, returns, stocktakes, production consumption and production completion to write batch allocations atomically.
2. Add reservation allocation by FEFO with expiry/quality filters and concurrency-safe row locks.
3. Add batch-aware inventory screens and traceability search.
4. Connect manufacturing quality holds, rebatch lots and production outputs to these batches.
5. Reconcile per product/warehouse: sum(batch quantity_on_hand) = inventory_stock_levels.quantity and sum(batch reserved_quantity) = inventory_stock_levels.reserved_quantity before activating batch enforcement.
