-- Tax classification groundwork. Existing products retain legacy treatment until
-- a company explicitly configures tax policy; this avoids changing historical behaviour.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS tax_treatment VARCHAR(20) NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_tax_treatment_check;
ALTER TABLE products
  ADD CONSTRAINT products_tax_treatment_check
  CHECK (tax_treatment IN ('legacy', 'standard', 'zero_rated', 'exempt', 'out_of_scope'));

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_tax_rate_check;
ALTER TABLE products
  ADD CONSTRAINT products_tax_rate_check
  CHECK (tax_rate >= 0 AND tax_rate <= 100);

COMMENT ON COLUMN products.tax_treatment IS
  'Tax treatment classification. legacy preserves pre-configuration behaviour; standard/zero_rated/exempt/out_of_scope are explicit classifications.';
COMMENT ON COLUMN products.tax_rate IS
  'Configured product tax rate percentage. Applicable only to standard treatment; statutory classification remains the company''s responsibility.';
