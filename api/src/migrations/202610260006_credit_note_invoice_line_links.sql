-- Credit-note lines must reference and preserve the tax snapshot of an original invoice line.
ALTER TABLE credit_note_items
  ADD COLUMN IF NOT EXISTS invoice_item_id UUID,
  ADD COLUMN IF NOT EXISTS tax_treatment VARCHAR(20) NOT NULL DEFAULT 'legacy';

ALTER TABLE credit_note_items
  DROP CONSTRAINT IF EXISTS credit_note_items_tax_treatment_check;
ALTER TABLE credit_note_items
  ADD CONSTRAINT credit_note_items_tax_treatment_check
  CHECK (tax_treatment IN ('legacy', 'standard', 'zero_rated', 'exempt', 'out_of_scope'));

CREATE INDEX IF NOT EXISTS idx_credit_note_items_invoice_line
  ON credit_note_items(company_id, invoice_item_id)
  WHERE invoice_item_id IS NOT NULL;

COMMENT ON COLUMN credit_note_items.invoice_item_id IS
  'Original invoice line this credit reverses; new credit notes must set this value.';
COMMENT ON COLUMN credit_note_items.tax_treatment IS
  'Tax treatment snapshot copied from the original invoice line.';
