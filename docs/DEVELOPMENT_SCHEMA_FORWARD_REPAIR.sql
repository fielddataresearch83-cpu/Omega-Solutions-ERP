-- Omega development schema forward-repair bundle
-- PURPOSE: Rehearse on an isolated clone only.
-- DO NOT execute against the shared development database until the documented
-- backup, catalog comparison, isolated rehearsal, and explicit approval gates pass.
-- This bundle intentionally does NOT modify omega_schema_migrations.
-- It does NOT rewrite historical financial amounts or link legacy credit-note rows.

BEGIN;

-- Fail closed if required base tables are absent.
DO $$
BEGIN
  IF to_regclass('public.invoice_items') IS NULL
     OR to_regclass('public.quotation_items') IS NULL
     OR to_regclass('public.supplier_bill_items') IS NULL
     OR to_regclass('public.credit_note_items') IS NULL
     OR to_regclass('public.supplier_bills') IS NULL THEN
    RAISE EXCEPTION 'Schema repair precondition failed: one or more required application tables are missing.';
  END IF;
END $$;

-- Transaction tax snapshots. Existing rows are explicitly legacy; no tax
-- amounts are recalculated and no historic classification is guessed.
ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS tax_treatment VARCHAR(20) NOT NULL DEFAULT 'legacy';
ALTER TABLE quotation_items
  ADD COLUMN IF NOT EXISTS tax_treatment VARCHAR(20) NOT NULL DEFAULT 'legacy';
ALTER TABLE supplier_bill_items
  ADD COLUMN IF NOT EXISTS tax_treatment VARCHAR(20) NOT NULL DEFAULT 'legacy';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM invoice_items WHERE tax_treatment NOT IN ('legacy','standard','zero_rated','exempt','out_of_scope'))
     OR EXISTS (SELECT 1 FROM quotation_items WHERE tax_treatment NOT IN ('legacy','standard','zero_rated','exempt','out_of_scope'))
     OR EXISTS (SELECT 1 FROM supplier_bill_items WHERE tax_treatment NOT IN ('legacy','standard','zero_rated','exempt','out_of_scope')) THEN
    RAISE EXCEPTION 'Unexpected tax_treatment value found; stop and review before adding constraints.';
  END IF;
END $$;

ALTER TABLE invoice_items DROP CONSTRAINT IF EXISTS invoice_items_tax_treatment_check;
ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_tax_treatment_check
  CHECK (tax_treatment IN ('legacy','standard','zero_rated','exempt','out_of_scope'));
ALTER TABLE quotation_items DROP CONSTRAINT IF EXISTS quotation_items_tax_treatment_check;
ALTER TABLE quotation_items ADD CONSTRAINT quotation_items_tax_treatment_check
  CHECK (tax_treatment IN ('legacy','standard','zero_rated','exempt','out_of_scope'));
ALTER TABLE supplier_bill_items DROP CONSTRAINT IF EXISTS supplier_bill_items_tax_treatment_check;
ALTER TABLE supplier_bill_items ADD CONSTRAINT supplier_bill_items_tax_treatment_check
  CHECK (tax_treatment IN ('legacy','standard','zero_rated','exempt','out_of_scope'));

COMMENT ON COLUMN invoice_items.tax_treatment IS 'Immutable-at-creation tax classification snapshot for this invoice line.';
COMMENT ON COLUMN quotation_items.tax_treatment IS 'Tax classification snapshot for this quotation line.';
COMMENT ON COLUMN supplier_bill_items.tax_treatment IS 'Tax classification snapshot for this supplier bill line; legacy means treatment was not classified.';

-- Credit-note line links. Do not infer links for historical rows.
ALTER TABLE credit_note_items
  ADD COLUMN IF NOT EXISTS invoice_item_id UUID,
  ADD COLUMN IF NOT EXISTS tax_treatment VARCHAR(20) NOT NULL DEFAULT 'legacy';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM credit_note_items WHERE tax_treatment NOT IN ('legacy','standard','zero_rated','exempt','out_of_scope')) THEN
    RAISE EXCEPTION 'Unexpected credit-note tax_treatment value; stop and review.';
  END IF;
END $$;

ALTER TABLE credit_note_items DROP CONSTRAINT IF EXISTS credit_note_items_tax_treatment_check;
ALTER TABLE credit_note_items ADD CONSTRAINT credit_note_items_tax_treatment_check
  CHECK (tax_treatment IN ('legacy','standard','zero_rated','exempt','out_of_scope'));

CREATE INDEX IF NOT EXISTS idx_credit_note_items_invoice_line
  ON credit_note_items(company_id, invoice_item_id)
  WHERE invoice_item_id IS NOT NULL;

COMMENT ON COLUMN credit_note_items.invoice_item_id IS
  'Original invoice line this credit reverses; new credit notes must set this value.';
COMMENT ON COLUMN credit_note_items.tax_treatment IS
  'Tax treatment snapshot copied from the original invoice line.';

-- Do not create the unique index if existing active supplier bills conflict.
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
    RAISE EXCEPTION 'Duplicate active supplier invoice references exist. Reconcile them with the data owner before continuing.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS supplier_bills_supplier_invoice_number_unique
  ON supplier_bills (company_id, supplier_id, LOWER(BTRIM(supplier_invoice_number)))
  WHERE status <> 'void'
    AND NULLIF(BTRIM(supplier_invoice_number), '') IS NOT NULL;

-- Postconditions: verify the expected columns and index exist before commit.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoice_items' AND column_name='tax_treatment')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='quotation_items' AND column_name='tax_treatment')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='supplier_bill_items' AND column_name='tax_treatment')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_note_items' AND column_name='invoice_item_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_note_items' AND column_name='tax_treatment')
     OR to_regclass('public.supplier_bills_supplier_invoice_number_unique') IS NULL THEN
    RAISE EXCEPTION 'Schema repair postcondition failed; transaction will roll back.';
  END IF;
END $$;

COMMIT;

-- IMPORTANT FOLLOW-UP:
-- 1. Reconcile the canonical migration ledger/checksums separately after proving
--    each original migration's complete effects. Never mark all missing files applied.
-- 2. This bundle does not repair RLS/policies/ownership or the other missing
--    migrations. Those require separate catalog-driven reviews and rehearsals.
-- 3. Run API build, unit tests, tenant-isolation negatives, and finance/stock
--    workflow smoke tests against the isolated clone before requesting approval.
