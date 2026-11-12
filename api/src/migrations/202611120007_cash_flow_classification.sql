ALTER TABLE chart_of_accounts
  ADD COLUMN IF NOT EXISTS cash_flow_category VARCHAR(16);

ALTER TABLE chart_of_accounts
  DROP CONSTRAINT IF EXISTS chart_of_accounts_cash_flow_category_check;

ALTER TABLE chart_of_accounts
  ADD CONSTRAINT chart_of_accounts_cash_flow_category_check
  CHECK (cash_flow_category IS NULL OR cash_flow_category IN ('operating','investing','financing'));

COMMENT ON COLUMN chart_of_accounts.cash_flow_category IS
  'Optional direct cash-flow classification for non-cash counterpart accounts; standard operating/investing/financing defaults are inferred when null.';

UPDATE chart_of_accounts
SET cash_flow_category = CASE
  WHEN system_code IN ('accounts_receivable','accounts_payable','inventory','work_in_progress','input_tax','output_tax','goods_received_not_invoiced','customer_credits') THEN 'operating'
  WHEN system_code='equity' THEN 'financing'
  WHEN system_code IN ('sales_revenue','purchases_expense','operating_expense') THEN 'operating'
  ELSE cash_flow_category
END
WHERE cash_flow_category IS NULL;
