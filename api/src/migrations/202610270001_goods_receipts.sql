-- Durable company-scoped goods receipt records for procurement traceability.
-- Existing journal-only historical receipts cannot be reconstructed reliably; this migration
-- preserves them as legacy journal entries and persists all receipts created after deployment.
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_order_items_id_company_unique
  ON purchase_order_items(id, company_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_id_company_unique
  ON warehouses(id, company_id);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  purchase_order_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  receipt_reference VARCHAR(200),
  notes VARCHAR(2000),
  received_by UUID REFERENCES users(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  receipt_value NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (receipt_value >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT goods_receipts_id_company_unique UNIQUE (id, company_id),
  CONSTRAINT goods_receipts_purchase_order_company_fk
    FOREIGN KEY (purchase_order_id, company_id)
    REFERENCES purchase_orders(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT goods_receipts_warehouse_company_fk
    FOREIGN KEY (warehouse_id, company_id)
    REFERENCES warehouses(id, company_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  goods_receipt_id UUID NOT NULL,
  purchase_order_item_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(14,2) NOT NULL CHECK (unit_cost >= 0),
  line_value NUMERIC(14,2) NOT NULL CHECK (line_value >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT goods_receipt_items_receipt_company_fk
    FOREIGN KEY (goods_receipt_id, company_id)
    REFERENCES goods_receipts(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT goods_receipt_items_po_line_company_fk
    FOREIGN KEY (purchase_order_item_id, company_id)
    REFERENCES purchase_order_items(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT goods_receipt_items_product_company_fk
    FOREIGN KEY (product_id, company_id)
    REFERENCES products(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT goods_receipt_items_receipt_po_line_unique
    UNIQUE (goods_receipt_id, purchase_order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_goods_receipts_company_received
  ON goods_receipts(company_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_company_po
  ON goods_receipts(company_id, purchase_order_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_items_company_receipt
  ON goods_receipt_items(company_id, goods_receipt_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_items_company_po_line
  ON goods_receipt_items(company_id, purchase_order_item_id);

ALTER TABLE goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipt_items ENABLE ROW LEVEL SECURITY;
