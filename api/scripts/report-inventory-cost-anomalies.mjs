// Read-only inventory valuation anomaly report (audit P0-3 / FIND-24).
//
// Finds positive-stock levels whose persisted weighted-average cost is zero even
// though the level has positive-cost inbound movement history. This script only
// reads: it opens a READ ONLY transaction and rolls back.
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/report-inventory-cost-anomalies.mjs
//
// Output is aggregate/identifier metadata only; no credentials are printed.
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required.');

const { Client } = pg;
const client = new Client({
  connectionString,
  ssl: connectionString.includes('neon.tech') ? { rejectUnauthorized: true } : undefined,
});

try {
  await client.connect();
  await client.query('BEGIN READ ONLY');

  const anomalies = await client.query(
    `WITH inbound AS (
       SELECT company_id, warehouse_id, product_id,
              SUM(quantity) AS inbound_quantity,
              SUM(quantity * unit_cost) AS inbound_value
       FROM inventory_stock_movements
       WHERE movement_type IN ('receipt','opening_balance','transfer_in')
         AND quantity > 0
         AND unit_cost > 0
       GROUP BY company_id, warehouse_id, product_id
     )
     SELECT s.id AS stock_level_id,
            s.company_id,
            c.name AS company_name,
            s.warehouse_id,
            w.name AS warehouse_name,
            s.product_id,
            p.name AS product_name,
            p.sku,
            s.quantity,
            s.average_unit_cost,
            i.inbound_quantity,
            i.inbound_value,
            ROUND((i.inbound_value / NULLIF(i.inbound_quantity, 0))::numeric, 4) AS implied_unit_cost
     FROM inventory_stock_levels s
     JOIN inbound i
       ON i.company_id = s.company_id
      AND i.warehouse_id = s.warehouse_id
      AND i.product_id = s.product_id
     JOIN companies c ON c.id = s.company_id
     JOIN warehouses w ON w.id = s.warehouse_id AND w.company_id = s.company_id
     JOIN products p ON p.id = s.product_id AND p.company_id = s.company_id
     WHERE s.quantity > 0
       AND s.average_unit_cost = 0
       AND i.inbound_quantity > 0
       AND i.inbound_value > 0
     ORDER BY s.company_id, s.product_id`,
  );

  console.log(`Inventory valuation anomalies found: ${anomalies.rowCount}`);
  for (const row of anomalies.rows) {
    console.log(JSON.stringify({
      stockLevelId: row.stock_level_id,
      companyId: row.company_id,
      company: row.company_name,
      warehouseId: row.warehouse_id,
      warehouse: row.warehouse_name,
      productId: row.product_id,
      product: row.product_name,
      sku: row.sku,
      quantity: Number(row.quantity),
      storedAverageUnitCost: Number(row.average_unit_cost),
      inboundQuantity: Number(row.inbound_quantity),
      inboundValue: Number(row.inbound_value),
      impliedAverageUnitCost: Number(row.implied_unit_cost),
    }));
  }

  if (anomalies.rowCount > 0) {
    console.log('\nDo not run a blanket repair. Use rehearse-inventory-cost-repair.mjs on an isolated clone, then apply the reviewed per-stock-level correction with owner approval.');
  }

  await client.query('ROLLBACK');
} finally {
  await client.end().catch(() => {});
}
