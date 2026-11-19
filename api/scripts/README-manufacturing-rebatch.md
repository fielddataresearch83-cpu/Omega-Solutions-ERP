# Manufacturing quality and rebatch rollout

Migration: `api/src/migrations/202611180001_manufacturing_quality_rebatch.sql`.

This is an additive schema change. It creates quality-event, approved rebatch-lot, production-order rebatch-reservation and lot-consumption records, and adds formula-version/snapshot fields to production orders. It does not post stock movements, alter inventory balances, create journal entries, or run against any database by itself.

## Implemented transaction flow

1. Quality events are created in a pending state and scoped to the active company/branch.
2. Approval quarantines the affected original batch and aggregate stock in one transaction, then creates one recoverable rebatch lot for the approved recoverable quantity.
3. Starting a production order locks eligible rebatch lots and reserves available recovered quantities first. It reserves only the remaining material requirement from ordinary warehouse stock. The lot-level reservation ledger prevents concurrent orders from claiming the same recovered quantity.
4. Completing a production order consumes the reserved rebatch lots and ordinary stock atomically. Rebatch consumption rows preserve lot/order/quantity/unit-cost lineage; the ordinary inventory movement records only the ordinary-stock portion, avoiding a second deduction of recovered stock that was never included in aggregate inventory.
5. Material cost is calculated from the actual unit costs of both sources. Finished production output remains quality-pending and is not automatically released as saleable stock.

All allocation and consumption steps are company/warehouse scoped and transactionally locked. If any allocation, reservation, or stock check fails, the production transaction rolls back.

## Release gates

- This migration remains a draft and has **not** been applied to any database.
- Run the migration only on an isolated development branch after backup/restore verification and explicit approval.
- Before Production, complete database-backed acceptance tests for tenant RLS, concurrent lot reservations, insufficient-stock rollback, lot consumption, cost reconciliation, and finished-goods quality release; then prepare a rollback plan and obtain separate Production approval.
