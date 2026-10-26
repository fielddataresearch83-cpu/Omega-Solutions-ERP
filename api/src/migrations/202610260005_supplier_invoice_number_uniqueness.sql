-- Prevent the same supplier invoice from being entered more than once for a supplier.
-- Existing duplicates are not deleted or modified: migration fails with a clear message
-- so the company can reconcile them before this constraint is applied.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM supplier_bills
    WHERE status <> 'void'
      AND NULLIF(BTRIM(supplier_invoice_number), '') IS NOT NULL
    GROUP BY company_id, supplier_id, LOWER(BTRIM(supplier_invoice_number))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce supplier invoice uniqueness: duplicate non-void supplier invoice numbers exist. Reconcile duplicates before rerunning this migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS supplier_bills_supplier_invoice_number_unique
  ON supplier_bills (company_id, supplier_id, LOWER(BTRIM(supplier_invoice_number)))
  WHERE status <> 'void'
    AND NULLIF(BTRIM(supplier_invoice_number), '') IS NOT NULL;
