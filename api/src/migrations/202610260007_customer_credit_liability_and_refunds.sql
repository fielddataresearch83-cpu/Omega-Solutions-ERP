-- Track credit-note value that exceeds open receivables as a customer liability.
INSERT INTO chart_of_accounts(company_id,code,name,account_type,normal_side,system_code)
SELECT c.id,'2050','Customer Credits Payable','liability','credit','customer_credits'
FROM companies c
ON CONFLICT(company_id,code) DO NOTHING;

CREATE TABLE IF NOT EXISTS customer_credit_balances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  credit_note_id UUID NOT NULL,
  credit_amount NUMERIC(14,2) NOT NULL CHECK (credit_amount > 0),
  refunded_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_credit_balance_refunded_limit CHECK (refunded_amount <= credit_amount),
  CONSTRAINT customer_credit_balance_note_unique UNIQUE(company_id,credit_note_id),
  CONSTRAINT customer_credit_balance_note_fk FOREIGN KEY(credit_note_id,company_id)
    REFERENCES credit_notes(id,company_id) ON DELETE RESTRICT,
  CONSTRAINT customer_credit_balance_id_company_unique UNIQUE(id,company_id)
);

CREATE TABLE IF NOT EXISTS customer_credit_refunds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_credit_balance_id UUID NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method VARCHAR(10) NOT NULL CHECK (method IN ('cash','bank','mpesa')),
  reference VARCHAR(120) NOT NULL,
  notes VARCHAR(500),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  refunded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_credit_refund_balance_company_fk
    FOREIGN KEY(customer_credit_balance_id,company_id)
    REFERENCES customer_credit_balances(id,company_id) ON DELETE RESTRICT,
  CONSTRAINT customer_credit_refund_reference_unique UNIQUE(company_id,method,reference),
  CONSTRAINT customer_credit_refund_id_company_unique UNIQUE(id,company_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_credit_balances_company_customer
  ON customer_credit_balances(company_id,customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_credit_refunds_balance
  ON customer_credit_refunds(company_id,customer_credit_balance_id,refunded_at DESC);
ALTER TABLE customer_credit_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_credit_refunds ENABLE ROW LEVEL SECURITY;
