-- Manufacturing quality holds, recoverable spoiled batches and controlled rebatching.
-- Additive only: no stock is moved and no existing production data is rewritten.
--
-- This file was never applied to a shared or production database. If a database
-- did record an earlier revision of it, the migration runner's checksum guard
-- will refuse the tree; correct that database with a reviewed follow-up
-- migration instead of rewriting the ledger.

ALTER TABLE manufacturing_production_orders
  ADD COLUMN IF NOT EXISTS bom_version_at_release INTEGER,
  ADD COLUMN IF NOT EXISTS formula_snapshot JSONB;

CREATE TABLE IF NOT EXISTS manufacturing_quality_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  production_order_id UUID,
  product_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  event_number VARCHAR(48) NOT NULL,
  event_type VARCHAR(24) NOT NULL CHECK (event_type IN ('spoiled','rejected','quality_hold')),
  original_batch_reference VARCHAR(100),
  affected_quantity NUMERIC(16,4) NOT NULL CHECK (affected_quantity > 0),
  recoverable_quantity NUMERIC(16,4) NOT NULL DEFAULT 0 CHECK (recoverable_quantity >= 0),
  disposal_quantity NUMERIC(16,4) NOT NULL DEFAULT 0 CHECK (disposal_quantity >= 0),
  reason TEXT NOT NULL,
  inspection_result TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','closed')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id,event_number),
  UNIQUE(id,company_id),
  FOREIGN KEY(production_order_id,company_id) REFERENCES manufacturing_production_orders(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(product_id,company_id) REFERENCES products(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(warehouse_id,company_id) REFERENCES warehouses(id,company_id) ON DELETE RESTRICT,
  CHECK (recoverable_quantity + disposal_quantity <= affected_quantity)
);

CREATE TABLE IF NOT EXISTS manufacturing_rebatch_lots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  quality_event_id UUID NOT NULL,
  product_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  lot_number VARCHAR(64) NOT NULL,
  original_batch_reference VARCHAR(100),
  quantity_received NUMERIC(16,4) NOT NULL CHECK (quantity_received > 0),
  quantity_remaining NUMERIC(16,4) NOT NULL CHECK (quantity_remaining >= 0 AND quantity_remaining <= quantity_received),
  unit_cost NUMERIC(16,4) NOT NULL CHECK (unit_cost >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (status IN ('available','partially_consumed','consumed','blocked','disposed')),
  approved_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id,lot_number),
  UNIQUE(quality_event_id),
  UNIQUE(id,company_id),
  FOREIGN KEY(quality_event_id,company_id) REFERENCES manufacturing_quality_events(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(product_id,company_id) REFERENCES products(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(warehouse_id,company_id) REFERENCES warehouses(id,company_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS manufacturing_rebatch_consumptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rebatch_lot_id UUID NOT NULL,
  production_order_id UUID NOT NULL,
  quantity NUMERIC(16,4) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(16,4) NOT NULL CHECK (unit_cost >= 0),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(id,company_id),
  FOREIGN KEY(rebatch_lot_id,company_id) REFERENCES manufacturing_rebatch_lots(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(production_order_id,company_id) REFERENCES manufacturing_production_orders(id,company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS manufacturing_quality_events_company_status_idx
  ON manufacturing_quality_events(company_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS manufacturing_quality_events_order_idx
  ON manufacturing_quality_events(company_id,production_order_id);
-- Recovered lots are usable while 'available' and while 'partially_consumed'.
-- manufacturing.service.ts selects exactly those two states when reserving a lot,
-- and the table's status domain has no 'released' value, so the earlier predicate
-- (status = 'released') could never match a row and the index was dead weight.
-- DROP first so a database that somehow recorded the old definition is corrected
-- rather than silently keeping an unusable index.
DROP INDEX IF EXISTS manufacturing_rebatch_lots_available_idx;
CREATE INDEX IF NOT EXISTS manufacturing_rebatch_lots_available_idx
  ON manufacturing_rebatch_lots(company_id,warehouse_id,product_id,status)
  WHERE status IN ('available','partially_consumed');
CREATE INDEX IF NOT EXISTS manufacturing_rebatch_consumptions_order_idx
  ON manufacturing_rebatch_consumptions(company_id,production_order_id);
CREATE INDEX IF NOT EXISTS manufacturing_rebatch_consumptions_lot_idx
  ON manufacturing_rebatch_consumptions(company_id,rebatch_lot_id);

-- Production-order reservations prevent the same recovered lot quantity being
-- promised to concurrent work orders before it is physically consumed.
CREATE TABLE IF NOT EXISTS manufacturing_rebatch_reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rebatch_lot_id UUID NOT NULL,
  production_order_id UUID NOT NULL,
  material_product_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  quantity NUMERIC(16,4) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(16,4) NOT NULL CHECK (unit_cost >= 0),
  status VARCHAR(16) NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','consumed','released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(id,company_id),
  FOREIGN KEY(rebatch_lot_id,company_id) REFERENCES manufacturing_rebatch_lots(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(production_order_id,company_id) REFERENCES manufacturing_production_orders(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(material_product_id,company_id) REFERENCES products(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(warehouse_id,company_id) REFERENCES warehouses(id,company_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS manufacturing_rebatch_reservations_order_idx
  ON manufacturing_rebatch_reservations(company_id,production_order_id,status);
CREATE INDEX IF NOT EXISTS manufacturing_rebatch_reservations_lot_idx
  ON manufacturing_rebatch_reservations(company_id,rebatch_lot_id,status);

ALTER TABLE manufacturing_quality_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturing_rebatch_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturing_rebatch_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturing_rebatch_reservations ENABLE ROW LEVEL SECURITY;

DO $policies$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['manufacturing_quality_events','manufacturing_rebatch_lots','manufacturing_rebatch_consumptions','manufacturing_rebatch_reservations'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS omega_company_isolation ON public.%I',t);
    EXECUTE format($policy$
      CREATE POLICY omega_company_isolation ON public.%I
      USING (
        company_id = NULLIF(current_setting('app.company_id',true),'')::uuid
        AND EXISTS (
          SELECT 1 FROM public.company_memberships m
          WHERE m.company_id = %I.company_id
            AND m.user_id = NULLIF(current_setting('app.user_id',true),'')::uuid
            AND m.is_active = true
        )
      )
      WITH CHECK (
        company_id = NULLIF(current_setting('app.company_id',true),'')::uuid
        AND EXISTS (
          SELECT 1 FROM public.company_memberships m
          WHERE m.company_id = %I.company_id
            AND m.user_id = NULLIF(current_setting('app.user_id',true),'')::uuid
            AND m.is_active = true
        )
      )
    $policy$,t,t,t);
  END LOOP;
END
$policies$;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='omega_app_dev') THEN
    EXECUTE 'GRANT SELECT,INSERT,UPDATE,DELETE ON manufacturing_quality_events,manufacturing_rebatch_lots,manufacturing_rebatch_consumptions,manufacturing_rebatch_reservations TO omega_app_dev';
  END IF;
END
$grants$;
