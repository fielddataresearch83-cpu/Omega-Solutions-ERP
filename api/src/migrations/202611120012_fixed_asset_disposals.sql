ALTER TABLE fixed_assets
 ADD COLUMN IF NOT EXISTS disposal_date DATE,
 ADD COLUMN IF NOT EXISTS disposal_proceeds NUMERIC(14,2),
 ADD COLUMN IF NOT EXISTS disposal_journal_entry_id UUID;

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='fixed_assets_disposal_journal_company_fk') THEN
  ALTER TABLE fixed_assets ADD CONSTRAINT fixed_assets_disposal_journal_company_fk
   FOREIGN KEY(disposal_journal_entry_id,company_id) REFERENCES journal_entries(id,company_id) ON DELETE RESTRICT;
 END IF;
END $$;

INSERT INTO chart_of_accounts(company_id,code,name,account_type,normal_side,system_code,cash_flow_category)
SELECT c.id,v.code,v.name,v.account_type,v.normal_side,v.system_code,v.cash_flow_category
FROM companies c
CROSS JOIN (VALUES
 ('4300','Gain on Disposal of Fixed Assets','income','credit','fixed_asset_disposal_gain','investing'),
 ('5300','Loss on Disposal of Fixed Assets','expense','debit','fixed_asset_disposal_loss','investing')
) AS v(code,name,account_type,normal_side,system_code,cash_flow_category)
ON CONFLICT(company_id,code) DO NOTHING;
