CREATE TABLE IF NOT EXISTS bank_statement_imports (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 bank_account_id UUID NOT NULL,
 statement_start DATE NOT NULL,
 statement_end DATE NOT NULL,
 opening_balance NUMERIC(14,2) NOT NULL,
 closing_balance NUMERIC(14,2) NOT NULL,
 file_name VARCHAR(255),
 status VARCHAR(20) NOT NULL DEFAULT 'imported' CHECK(status IN ('imported','reconciled')),
 created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 reconciled_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(statement_end>=statement_start),
 CONSTRAINT bank_statement_imports_account_company_fk
  FOREIGN KEY(bank_account_id,company_id) REFERENCES chart_of_accounts(id,company_id) ON DELETE RESTRICT,
 UNIQUE(id,company_id)
);

CREATE TABLE IF NOT EXISTS bank_statement_lines (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 statement_import_id UUID NOT NULL,
 bank_account_id UUID NOT NULL,
 transaction_date DATE NOT NULL,
 description VARCHAR(500) NOT NULL,
 reference VARCHAR(160),
 debit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(debit>=0),
 credit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(credit>=0),
 running_balance NUMERIC(14,2),
 status VARCHAR(16) NOT NULL DEFAULT 'unmatched' CHECK(status IN ('unmatched','matched')),
 matched_journal_entry_id UUID,
 matched_by UUID REFERENCES users(id) ON DELETE SET NULL,
 matched_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(NOT (debit>0 AND credit>0)),
 CHECK(debit>0 OR credit>0),
 CONSTRAINT bank_statement_lines_import_company_fk
  FOREIGN KEY(statement_import_id,company_id) REFERENCES bank_statement_imports(id,company_id) ON DELETE CASCADE,
 CONSTRAINT bank_statement_lines_account_company_fk
  FOREIGN KEY(bank_account_id,company_id) REFERENCES chart_of_accounts(id,company_id) ON DELETE RESTRICT,
 CONSTRAINT bank_statement_lines_journal_company_fk
  FOREIGN KEY(matched_journal_entry_id,company_id) REFERENCES journal_entries(id,company_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS bank_statement_line_match_unique
 ON bank_statement_lines(company_id,bank_account_id,matched_journal_entry_id)
 WHERE matched_journal_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS bank_statement_imports_company_date
 ON bank_statement_imports(company_id,statement_end DESC,created_at DESC);

CREATE INDEX IF NOT EXISTS bank_statement_lines_import_status
 ON bank_statement_lines(company_id,statement_import_id,status,transaction_date);

ALTER TABLE bank_statement_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_statement_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS omega_company_isolation ON bank_statement_imports;
CREATE POLICY omega_company_isolation ON bank_statement_imports
 USING (
  company_id=NULLIF(current_setting('app.company_id',true),'')::uuid
  AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=bank_statement_imports.company_id
   AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true)
 )
 WITH CHECK (
  company_id=NULLIF(current_setting('app.company_id',true),'')::uuid
  AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=bank_statement_imports.company_id
   AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true)
 );

DROP POLICY IF EXISTS omega_company_isolation ON bank_statement_lines;
CREATE POLICY omega_company_isolation ON bank_statement_lines
 USING (
  company_id=NULLIF(current_setting('app.company_id',true),'')::uuid
  AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=bank_statement_lines.company_id
   AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true)
 )
 WITH CHECK (
  company_id=NULLIF(current_setting('app.company_id',true),'')::uuid
  AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=bank_statement_lines.company_id
   AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true)
 );
