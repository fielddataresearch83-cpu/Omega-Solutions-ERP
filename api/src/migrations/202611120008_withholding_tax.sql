-- Kenyan supplier tax identifiers and withholding-tax settlement support.
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS kra_pin VARCHAR(20);

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_company_kra_pin
  ON suppliers(company_id,kra_pin)
  WHERE kra_pin IS NOT NULL AND btrim(kra_pin)<>'';

ALTER TABLE supplier_bill_payments
  ADD COLUMN IF NOT EXISTS withholding_tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cash_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS withholding_certificate_number VARCHAR(120);

UPDATE supplier_bill_payments
SET cash_amount = amount - withholding_tax_amount
WHERE cash_amount IS NULL;

ALTER TABLE supplier_bill_payments
  ALTER COLUMN cash_amount SET NOT NULL;

ALTER TABLE supplier_bill_payments
  DROP CONSTRAINT IF EXISTS supplier_bill_payments_amount_split_check;

ALTER TABLE supplier_bill_payments
  ADD CONSTRAINT supplier_bill_payments_amount_split_check
  CHECK (
    withholding_tax_amount >= 0
    AND cash_amount >= 0
    AND cash_amount + withholding_tax_amount = amount
  );

INSERT INTO chart_of_accounts(company_id,code,name,account_type,normal_side,system_code,cash_flow_category)
SELECT c.id,'2060','Withholding Tax Payable','liability','credit','withholding_tax_payable','operating'
FROM companies c
ON CONFLICT(company_id,code) DO NOTHING;

