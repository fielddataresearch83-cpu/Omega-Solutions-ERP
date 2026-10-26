-- Preserve the tax treatment applied at the time each transaction line is created.
-- Legacy rows remain explicitly marked legacy; no historical amounts are recalculated.
ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS tax_treatment VARCHAR(20) NOT NULL DEFAULT 'legacy';
ALTER TABLE invoice_items
  DROP CONSTRAINT IF EXISTS invoice_items_tax_treatment_check;
ALTER TABLE invoice_items
  ADD CONSTRAINT invoice_items_tax_treatment_check
  CHECK (tax_treatment IN ('legacy', 'standard', 'zero_rated', 'exempt', 'out_of_scope'));

ALTER TABLE quotation_items
  ADD COLUMN IF NOT EXISTS tax_treatment VARCHAR(20) NOT NULL DEFAULT 'legacy';
ALTER TABLE quotation_items
  DROP CONSTRAINT IF EXISTS quotation_items_tax_treatment_check;
ALTER TABLE quotation_items
  ADD CONSTRAINT quotation_items_tax_treatment_check
  CHECK (tax_treatment IN ('legacy', 'standard', 'zero_rated', 'exempt', 'out_of_scope'));

ALTER TABLE supplier_bill_items
  ADD COLUMN IF NOT EXISTS tax_treatment VARCHAR(20) NOT NULL DEFAULT 'legacy';
ALTER TABLE supplier_bill_items
  DROP CONSTRAINT IF EXISTS supplier_bill_items_tax_treatment_check;
ALTER TABLE supplier_bill_items
  ADD CONSTRAINT supplier_bill_items_tax_treatment_check
  CHECK (tax_treatment IN ('legacy', 'standard', 'zero_rated', 'exempt', 'out_of_scope'));

COMMENT ON COLUMN invoice_items.tax_treatment IS 'Immutable-at-creation tax classification snapshot for this invoice line.';
COMMENT ON COLUMN quotation_items.tax_treatment IS 'Tax classification snapshot for this quotation line.';
COMMENT ON COLUMN supplier_bill_items.tax_treatment IS 'Tax classification snapshot for this supplier bill line; legacy means treatment was not classified.';
