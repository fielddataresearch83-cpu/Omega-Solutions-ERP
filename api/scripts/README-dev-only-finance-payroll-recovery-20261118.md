# Development-only finance/payroll recovery

These scripts are a one-off recovery record for Neon branch `omega-migration-smoke-test-live`. They are deliberately stored under `api/scripts/`, **not** `api/src/migrations/`, so the normal migration runner cannot apply them to Production.

Recovery sequence used on 18 November 2026:

1. Create the nine missing tables and current-version columns with `dev-only-finance-payroll-recovery-20261118.sql`.
2. Copy the nine historical tables from the existing preserved branch `omega-dev-preserve-before-cleanup-2026-10-23` using JSONB record batches, preserving primary keys and using `ON CONFLICT DO NOTHING`.
3. Run `dev-only-finance-payroll-recovery-finalize-20261118.sql` to restore post-October chart-of-accounts seeds, cash-flow classifications, foreign keys on surviving finance tables, tenant RLS policies and `omega_app_dev` grants.
4. Verify row counts, referential integrity, journal balancing, app-role RLS visibility and zero visibility without tenant context.

Do not run either script against Production or as part of an automatic deployment. The 18 November recovery was applied directly to the development branch; the migration ledger for the 82 normal source migrations was left unchanged.
