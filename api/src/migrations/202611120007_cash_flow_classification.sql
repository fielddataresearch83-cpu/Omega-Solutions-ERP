ALTER TABLE chart_of_accounts
  ADD COLUMN IF NOT EXISTS cash_flow_category VARCHAR(16);

ALTER TABLE chart_of_accounts
  DROP CONSTRAINT IF EXISTS chart_of_accounts_cash_flow_category_check;

ALTER TABLE chart_of_accounts
  ADD CONSTRAINT chart_of_accounts_cash_flow_category_check
  CHECK (cash_flow_category IS NULL OR cash_flow_category IN ('operating','investing','financing'));

COMMENT ON COLUMN chart_of_accounts.cash_flow_category IS
  'Optional direct cash-flow classification for non-cash counterpart accounts; standard operating/investing/financing defaults are inferred when null.';
