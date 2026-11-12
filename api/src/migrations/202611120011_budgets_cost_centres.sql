CREATE TABLE IF NOT EXISTS cost_centres (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 code VARCHAR(40) NOT NULL,
 name VARCHAR(160) NOT NULL,
 description VARCHAR(1000),
 is_active BOOLEAN NOT NULL DEFAULT true,
 created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(company_id,code),
 UNIQUE(id,company_id)
);

ALTER TABLE journal_entry_lines
 ADD COLUMN IF NOT EXISTS cost_centre_id UUID;

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='journal_entry_lines_cost_centre_company_fk') THEN
  ALTER TABLE journal_entry_lines
   ADD CONSTRAINT journal_entry_lines_cost_centre_company_fk
   FOREIGN KEY(cost_centre_id,company_id) REFERENCES cost_centres(id,company_id) ON DELETE RESTRICT;
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS budgets (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 fiscal_year INTEGER NOT NULL CHECK(fiscal_year BETWEEN 2000 AND 2200),
 period_month SMALLINT NOT NULL CHECK(period_month BETWEEN 1 AND 12),
 account_id UUID NOT NULL,
 cost_centre_id UUID,
 budget_amount NUMERIC(14,2) NOT NULL CHECK(budget_amount>=0),
 status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),
 created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY(account_id,company_id) REFERENCES chart_of_accounts(id,company_id) ON DELETE RESTRICT,
 FOREIGN KEY(cost_centre_id,company_id) REFERENCES cost_centres(id,company_id) ON DELETE RESTRICT,
 UNIQUE(id,company_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS budgets_company_period_account_costcentre_unique
 ON budgets(company_id,fiscal_year,period_month,account_id,COALESCE(cost_centre_id,'00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS budgets_company_period ON budgets(company_id,fiscal_year,period_month);
CREATE INDEX IF NOT EXISTS cost_centres_company_active ON cost_centres(company_id,is_active,code);

ALTER TABLE cost_centres ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS omega_company_isolation ON cost_centres;
CREATE POLICY omega_company_isolation ON cost_centres
 USING (
  company_id=NULLIF(current_setting('app.company_id',true),'')::uuid
  AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=cost_centres.company_id
   AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true)
 )
 WITH CHECK (
  company_id=NULLIF(current_setting('app.company_id',true),'')::uuid
  AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=cost_centres.company_id
   AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true)
 );

DROP POLICY IF EXISTS omega_company_isolation ON budgets;
CREATE POLICY omega_company_isolation ON budgets
 USING (
  company_id=NULLIF(current_setting('app.company_id',true),'')::uuid
  AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=budgets.company_id
   AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true)
 )
 WITH CHECK (
  company_id=NULLIF(current_setting('app.company_id',true),'')::uuid
  AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=budgets.company_id
   AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true)
 );
