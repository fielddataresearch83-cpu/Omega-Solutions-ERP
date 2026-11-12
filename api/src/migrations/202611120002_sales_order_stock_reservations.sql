-- Sales-order stock reservations. Apply manually to the development database after review.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_order_items_id_company_unique
  ON sales_order_items(id, company_id);

CREATE TABLE IF NOT EXISTS sales_order_reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sales_order_id UUID NOT NULL,
  sales_order_item_id UUID NOT NULL,
  product_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  quantity NUMERIC(16,4) NOT NULL CHECK (quantity > 0),
  status VARCHAR(16) NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved','released','consumed')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  CONSTRAINT sales_order_reservations_order_company_fk
    FOREIGN KEY (sales_order_id, company_id)
    REFERENCES sales_orders(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT sales_order_reservations_item_company_fk
    FOREIGN KEY (sales_order_item_id, company_id)
    REFERENCES sales_order_items(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT sales_order_reservations_product_company_fk
    FOREIGN KEY (product_id, company_id)
    REFERENCES products(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT sales_order_reservations_warehouse_company_fk
    FOREIGN KEY (warehouse_id, company_id)
    REFERENCES warehouses(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_sales_order_reservations_active_order
  ON sales_order_reservations(company_id, sales_order_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_order_reservations_stock
  ON sales_order_reservations(company_id, warehouse_id, product_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_order_reservations_one_active_per_line
  ON sales_order_reservations(company_id, sales_order_item_id)
  WHERE status = 'reserved';

ALTER TABLE sales_order_reservations ENABLE ROW LEVEL SECURITY;
