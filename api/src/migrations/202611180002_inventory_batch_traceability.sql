-- Additive batch/lot foundation. Apply manually to a disposable development DB first.
-- Existing aggregate stock is represented by one released legacy snapshot lot per stock row.
-- Historical movements remain unallocated: their original lot identity cannot be reconstructed.

CREATE TABLE IF NOT EXISTS inventory_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  batch_code VARCHAR(100) NOT NULL,
  manufactured_on DATE,
  expires_on DATE,
  received_quantity NUMERIC(18,4) NOT NULL CHECK (received_quantity > 0),
  quantity_on_hand NUMERIC(18,4) NOT NULL CHECK (quantity_on_hand >= 0),
  reserved_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  unit_cost NUMERIC(18,4) NOT NULL CHECK (unit_cost >= 0),
  source_type VARCHAR(40) NOT NULL DEFAULT 'receipt'
    CHECK (source_type IN ('receipt','production','rebatch','transfer','opening_balance','legacy_snapshot','return')),
  source_reference VARCHAR(160),
  quality_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (quality_status IN ('pending','released','hold','rejected')),
  status VARCHAR(20) NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','depleted','blocked','expired')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_batches_reserved_lte_on_hand CHECK (reserved_quantity <= quantity_on_hand),
  CONSTRAINT inventory_batches_expiry_after_manufacture CHECK (expires_on IS NULL OR manufactured_on IS NULL OR expires_on >= manufactured_on),
  CONSTRAINT inventory_batches_product_company_fk FOREIGN KEY (product_id, company_id)
    REFERENCES products(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_batches_warehouse_company_fk FOREIGN KEY (warehouse_id, company_id)
    REFERENCES warehouses(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_batches_id_company_product_warehouse_key UNIQUE (id, company_id, product_id, warehouse_id),
  CONSTRAINT inventory_batches_company_batch_code_key UNIQUE (company_id, batch_code)
);

CREATE INDEX IF NOT EXISTS inventory_batches_fefo_idx
  ON inventory_batches(company_id, product_id, warehouse_id, expires_on, created_at)
  WHERE status = 'available' AND quality_status = 'released' AND quantity_on_hand > reserved_quantity;
CREATE INDEX IF NOT EXISTS inventory_batches_source_idx
  ON inventory_batches(company_id, source_type, source_reference);

-- PostgreSQL requires an exact unique key for the composite tenant/product/warehouse FK.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_stock_movements_batch_reference_key
  ON inventory_stock_movements(id, company_id, product_id, warehouse_id);

-- One stock movement may consume or produce quantities from several lots (FEFO, split lots).
CREATE TABLE IF NOT EXISTS inventory_stock_movement_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  movement_id UUID NOT NULL,
  batch_id UUID NOT NULL,
  product_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(18,4) NOT NULL CHECK (unit_cost >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_movement_allocations_movement_fk
    FOREIGN KEY (movement_id, company_id, product_id, warehouse_id)
    REFERENCES inventory_stock_movements(id, company_id, product_id, warehouse_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_movement_allocations_batch_fk
    FOREIGN KEY (batch_id, company_id, product_id, warehouse_id)
    REFERENCES inventory_batches(id, company_id, product_id, warehouse_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_movement_allocations_unique UNIQUE (movement_id, batch_id)
);

CREATE INDEX IF NOT EXISTS inventory_movement_allocations_batch_idx
  ON inventory_stock_movement_allocations(company_id, batch_id, created_at);
CREATE INDEX IF NOT EXISTS inventory_movement_allocations_movement_idx
  ON inventory_stock_movement_allocations(company_id, movement_id);

-- Legacy aggregate stock becomes a released snapshot lot; no stock balance or movement is changed.
INSERT INTO inventory_batches (
  company_id, product_id, warehouse_id, batch_code, received_quantity,
  quantity_on_hand, reserved_quantity, unit_cost, source_type, source_reference,
  quality_status, status, created_at, updated_at
)
SELECT s.company_id, s.product_id, s.warehouse_id,
       'LEGACY-' || UPPER(SUBSTRING(s.id::text FROM 1 FOR 12)),
       s.quantity, s.quantity, s.reserved_quantity, s.average_unit_cost,
       'legacy_snapshot', s.id::text, 'released',
       CASE WHEN s.quantity <= s.reserved_quantity THEN 'depleted' ELSE 'available' END,
       s.updated_at, s.updated_at
FROM inventory_stock_levels s
WHERE s.quantity > 0
  AND NOT EXISTS (
    SELECT 1 FROM inventory_batches b
    WHERE b.company_id = s.company_id AND b.source_type = 'legacy_snapshot'
      AND b.source_reference = s.id::text
  );

-- Preserve the exact lots held for each sales-order reservation through cancellation or fulfilment.
CREATE UNIQUE INDEX IF NOT EXISTS sales_order_reservations_batch_reference_key
  ON sales_order_reservations(id, company_id, product_id, warehouse_id);

CREATE TABLE IF NOT EXISTS sales_order_reservation_batch_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  reservation_id UUID NOT NULL, batch_id UUID NOT NULL, product_id UUID NOT NULL, warehouse_id UUID NOT NULL,
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  status VARCHAR(16) NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','released','consumed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_order_reservation_batch_reservation_fk FOREIGN KEY (reservation_id, company_id, product_id, warehouse_id)
    REFERENCES sales_order_reservations(id, company_id, product_id, warehouse_id) ON DELETE RESTRICT,
  CONSTRAINT sales_order_reservation_batch_batch_fk FOREIGN KEY (batch_id, company_id, product_id, warehouse_id)
    REFERENCES inventory_batches(id, company_id, product_id, warehouse_id) ON DELETE RESTRICT,
  CONSTRAINT sales_order_reservation_batch_unique UNIQUE (reservation_id, batch_id)
);
CREATE INDEX IF NOT EXISTS sales_order_reservation_batch_active_idx
  ON sales_order_reservation_batch_allocations(company_id, reservation_id) WHERE status = 'reserved';

ALTER TABLE inventory_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_stock_movement_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_reservation_batch_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS omega_company_isolation ON inventory_batches;
CREATE POLICY omega_company_isolation ON inventory_batches
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM company_memberships m
      WHERE m.company_id = inventory_batches.company_id
        AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND m.is_active = true
    )
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM company_memberships m
      WHERE m.company_id = inventory_batches.company_id
        AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND m.is_active = true
    )
  );

DROP POLICY IF EXISTS omega_company_isolation ON inventory_stock_movement_allocations;
CREATE POLICY omega_company_isolation ON inventory_stock_movement_allocations
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM company_memberships m
      WHERE m.company_id = inventory_stock_movement_allocations.company_id
        AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND m.is_active = true
    )
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM company_memberships m
      WHERE m.company_id = inventory_stock_movement_allocations.company_id
        AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND m.is_active = true
    )
  );

DROP POLICY IF EXISTS omega_company_isolation ON sales_order_reservation_batch_allocations;
CREATE POLICY omega_company_isolation ON sales_order_reservation_batch_allocations
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid AND EXISTS (
    SELECT 1 FROM company_memberships m WHERE m.company_id = sales_order_reservation_batch_allocations.company_id
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND m.is_active = true))
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid AND EXISTS (
    SELECT 1 FROM company_memberships m WHERE m.company_id = sales_order_reservation_batch_allocations.company_id
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND m.is_active = true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omega_app_dev') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_batches TO omega_app_dev';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_stock_movement_allocations TO omega_app_dev';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON sales_order_reservation_batch_allocations TO omega_app_dev';
  END IF;
END $$;
