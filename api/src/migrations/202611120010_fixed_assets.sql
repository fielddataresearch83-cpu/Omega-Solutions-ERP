CREATE TABLE IF NOT EXISTS fixed_assets (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 asset_code VARCHAR(60) NOT NULL,
 name VARCHAR(240) NOT NULL,
 description TEXT,
 acquisition_date DATE NOT NULL,
 cost NUMERIC(14,2) NOT NULL CHECK(cost>0),
 residual_value NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(residual_value>=0),
 useful_life_months INTEGER NOT NULL CHECK(useful_life_months>0),
 accumulated_depreciation NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(accumulated_depreciation>=0),
 asset_account_id UUID NOT NULL,
 accumulated_depreciation_account_id UUID NOT NULL,
 depreciation_expense_account_id UUID NOT NULL,
 payment_account_id UUID NOT NULL,
 acquisition_journal_entry_id UUID,
 status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK(status IN ('active','fully_depreciated','disposed')),
 created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(residual_value<=cost),
 CHECK(accumulated_depreciation<=cost-residual_value),
 UNIQUE(company_id,asset_code),
 UNIQUE(id,company_id),
 FOREIGN KEY(asset_account_id,company_id) REFERENCES chart_of_accounts(id,company_id) ON DELETE RESTRICT,
 FOREIGN KEY(accumulated_depreciation_account_id,company_id) REFERENCES chart_of_accounts(id,company_id) ON DELETE RESTRICT,
 FOREIGN KEY(depreciation_expense_account_id,company_id) REFERENCES chart_of_accounts(id,company_id) ON DELETE RESTRICT,
 FOREIGN KEY(payment_account_id,company_id) REFERENCES chart_of_accounts(id,company_id) ON DELETE RESTRICT,
 FOREIGN KEY(acquisition_journal_entry_id,company_id) REFERENCES journal_entries(id,company_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS fixed_asset_depreciation (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 asset_id UUID NOT NULL,
 period_end DATE NOT NULL,
 depreciation_amount NUMERIC(14,2) NOT NULL CHECK(depreciation_amount>0),
 journal_entry_id UUID NOT NULL,
 posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
 posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(company_id,asset_id,period_end),
 FOREIGN KEY(asset_id,company_id) REFERENCES fixed_assets(id,company_id) ON DELETE RESTRICT,
 FOREIGN KEY(journal_entry_id,company_id) REFERENCES journal_entries(id,company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS fixed_assets_company_status ON fixed_assets(company_id,status,asset_code);
CREATE INDEX IF NOT EXISTS fixed_asset_depreciation_period ON fixed_asset_depreciation(company_id,period_end,asset_id);

ALTER TABLE fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_asset_depreciation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS omega_company_isolation ON fixed_assets;
CREATE POLICY omega_company_isolation ON fixed_assets
 USING (
  company_id=NULLIF(current_setting('app.company_id',true),'')::uuid
  AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=fixed_assets.company_id
   AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true)
 )
 WITH CHECK (
  company_id=NULLIF(current_setting('app.company_id',true),'')::uuid
  AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=fixed_assets.company_id
   AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true)
 );

DROP POLICY IF EXISTS omega_company_isolation ON fixed_asset_depreciation;
CREATE POLICY omega_company_isolation ON fixed_asset_depreciation
 USING (
  company_id=NULLIF(current_setting('app.company_id',true),'')::uuid
  AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=fixed_asset_depreciation.company_id
   AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true)
 )
 WITH CHECK (
  company_id=NULLIF(current_setting('app.company_id',true),'')::uuid
  AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=fixed_asset_depreciation.company_id
   AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true)
 );

INSERT INTO chart_of_accounts(company_id,code,name,account_type,normal_side,system_code,cash_flow_category)
SELECT c.id,v.code,v.name,v.account_type,v.normal_side,v.system_code,v.cash_flow_category
FROM companies c
CROSS JOIN (VALUES
 ('1500','Fixed Assets','asset','debit','fixed_assets','investing'),
 ('1590','Accumulated Depreciation','asset','credit','accumulated_depreciation','investing'),
 ('5200','Depreciation Expense','expense','debit','depreciation_expense','operating')
) AS v(code,name,account_type,normal_side,system_code,cash_flow_category)
ON CONFLICT(company_id,code) DO NOTHING;
