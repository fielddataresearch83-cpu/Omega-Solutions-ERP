-- Link purchase orders to their approved requisition and retain GRN discrepancies.
-- Additive only: no historical records or production data are rewritten.
CREATE UNIQUE INDEX IF NOT EXISTS idx_requisitions_id_company_unique
  ON requisitions(id, company_id);

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS requisition_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_orders_requisition_company_fk'
      AND conrelid = 'purchase_orders'::regclass
  ) THEN
    ALTER TABLE purchase_orders
      ADD CONSTRAINT purchase_orders_requisition_company_fk
      FOREIGN KEY (requisition_id, company_id)
      REFERENCES requisitions(id, company_id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_orders_company_requisition_unique
  ON purchase_orders(company_id, requisition_id)
  WHERE requisition_id IS NOT NULL AND status <> 'cancelled';

ALTER TABLE goods_receipts
  ADD COLUMN IF NOT EXISTS discrepancy_notes VARCHAR(4000);
