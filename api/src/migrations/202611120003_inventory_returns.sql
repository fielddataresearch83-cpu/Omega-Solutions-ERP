-- Physical inventory returns and inspection ledger. Apply manually to development after review.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_id_company_return_fk ON customers(id,company_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_id_company_return_fk ON suppliers(id,company_id);

CREATE TABLE IF NOT EXISTS inventory_returns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  return_number VARCHAR(48) NOT NULL,
  return_type VARCHAR(16) NOT NULL CHECK (return_type IN ('customer','supplier')),
  customer_id UUID,
  supplier_id UUID,
  supplier_bill_id UUID,
  warehouse_id UUID NOT NULL,
  source_reference VARCHAR(120),
  reason VARCHAR(1000) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_at TIMESTAMPTZ,
  CONSTRAINT inventory_returns_party_check CHECK (
    (return_type='customer' AND customer_id IS NOT NULL AND supplier_id IS NULL) OR
    (return_type='supplier' AND supplier_id IS NOT NULL AND customer_id IS NULL)
  ),
  CONSTRAINT inventory_returns_customer_company_fk FOREIGN KEY (customer_id,company_id) REFERENCES customers(id,company_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_returns_supplier_company_fk FOREIGN KEY (supplier_id,company_id) REFERENCES suppliers(id,company_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_returns_supplier_bill_company_fk FOREIGN KEY (supplier_bill_id,company_id) REFERENCES supplier_bills(id,company_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_returns_warehouse_company_fk FOREIGN KEY (warehouse_id,company_id)
    REFERENCES warehouses(id,company_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_returns_id_company_unique UNIQUE(id,company_id),
  CONSTRAINT inventory_returns_number_unique UNIQUE(company_id,return_number)
);
CREATE TABLE IF NOT EXISTS inventory_return_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  return_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity NUMERIC(16,4) NOT NULL CHECK(quantity>0),
  unit_cost NUMERIC(16,4) NOT NULL CHECK(unit_cost>=0),
  disposition VARCHAR(24) NOT NULL CHECK(disposition IN ('restock','quarantine','reject','return_to_supplier')),
  inspection_notes VARCHAR(2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_return_lines_return_company_fk FOREIGN KEY(return_id,company_id)
    REFERENCES inventory_returns(id,company_id) ON DELETE CASCADE,
  CONSTRAINT inventory_return_lines_product_company_fk FOREIGN KEY(product_id,company_id)
    REFERENCES products(id,company_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_inventory_returns_company_date ON inventory_returns(company_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_returns_warehouse_status ON inventory_returns(company_id,warehouse_id,status);
CREATE INDEX IF NOT EXISTS idx_inventory_return_lines_return ON inventory_return_lines(company_id,return_id);
CREATE TABLE IF NOT EXISTS inventory_quarantine_balances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity NUMERIC(16,4) NOT NULL DEFAULT 0 CHECK(quantity>=0),
  average_unit_cost NUMERIC(16,4) NOT NULL DEFAULT 0 CHECK(average_unit_cost>=0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_quarantine_warehouse_company_fk FOREIGN KEY(warehouse_id,company_id)
    REFERENCES warehouses(id,company_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_quarantine_product_company_fk FOREIGN KEY(product_id,company_id)
    REFERENCES products(id,company_id) ON DELETE RESTRICT,
  UNIQUE(company_id,warehouse_id,product_id)
);
ALTER TABLE inventory_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_return_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_quarantine_balances ENABLE ROW LEVEL SECURITY;
