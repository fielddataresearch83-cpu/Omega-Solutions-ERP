import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AccountingService } from '../accounting/accounting.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import type { AdjustStockDto, CountStocktakeLineDto, CreateInventoryReturnDto, ResolveInventoryQuarantineDto, CreateStockMovementDto, CreateStocktakeDto, CreateWarehouseDto, TransferStockDto, UpdateWarehouseDto } from './dto/inventory.dto.js';

type WarehouseRow = {
  id: string; company_id: string; branch_id: string | null; code: string; name: string;
  location: string | null; capacity: string | number; is_active: boolean;
  created_at: string; updated_at: string; branch_name?: string | null;
  product_count?: string | number; total_quantity?: string | number;
};
type StockRow = {
  id: string; company_id: string; warehouse_id: string; product_id: string;
  quantity: string | number; reserved_quantity: string | number; reorder_level: string | number;
  updated_at: string; warehouse_name: string; warehouse_code: string; sku: string;
  product_name: string; unit: string; cost_price: string | number; selling_price: string | number;
  average_unit_cost: string | number;
  available_quantity?: string | number; status?: string;
};
type MovementRow = {
  id: string; company_id: string; product_id: string; warehouse_id: string;
  movement_type: string; quantity: string | number; unit_cost: string | number;
  reference: string | null; notes: string | null; transfer_group_id: string | null;
  created_by: string | null; created_at: string; product_name?: string; sku?: string;
  warehouse_name?: string;
};

@Injectable()
export class InventoryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly memberships: MembershipsService,
    private readonly audit: AuditService,
    private readonly accounting: AccountingService,
  ) {}

  private async resolveMembership(user: AuthenticatedUser) {
    // The signed token identifies the selected company. Never silently fall back
    // to another membership when that company was explicitly selected.
    if (user.companyId) {
      return this.memberships.getMembershipForCompany(user.userId, user.companyId);
    }
    return this.memberships.getMembership(user.userId);
  }

  async listWarehouses(user: AuthenticatedUser): Promise<WarehouseRow[]> {
    const { companyId, branchId } = await this.resolveMembership(user);
    const result = await this.db.query<WarehouseRow>(
      `SELECT w.id,w.company_id,w.branch_id,w.code,w.name,w.location,w.capacity,w.is_active,w.created_at,w.updated_at,
              b.name AS branch_name,
              COUNT(DISTINCT s.product_id)::int AS product_count,
              COALESCE(SUM(s.quantity),0) AS total_quantity
       FROM warehouses w LEFT JOIN branches b ON b.id=w.branch_id AND b.company_id=w.company_id
       LEFT JOIN inventory_stock_levels s ON s.warehouse_id=w.id AND s.company_id=w.company_id
       WHERE w.company_id=$1 AND ($2::uuid IS NULL OR w.branch_id=$2) GROUP BY w.id,b.name ORDER BY w.is_active DESC,w.name`,
      [companyId, branchId],
    );
    return result.rows;
  }

  async getWarehouse(user: AuthenticatedUser, warehouseId: string): Promise<WarehouseRow> {
    const { companyId, branchId } = await this.resolveMembership(user);
    const result = await this.db.query<WarehouseRow>(
      `SELECT w.*,b.name AS branch_name,
        COUNT(DISTINCT s.product_id)::int AS product_count,COALESCE(SUM(s.quantity),0) AS total_quantity
       FROM warehouses w LEFT JOIN branches b ON b.id=w.branch_id AND b.company_id=w.company_id
       LEFT JOIN inventory_stock_levels s ON s.warehouse_id=w.id AND s.company_id=w.company_id
       WHERE w.id=$1 AND w.company_id=$2 AND ($3::uuid IS NULL OR w.branch_id=$3) GROUP BY w.id,b.name`,
      [warehouseId, companyId, branchId],
    );
    if (!result.rows[0]) throw new NotFoundException('Warehouse not found.');
    return result.rows[0];
  }

  async createWarehouse(user: AuthenticatedUser, dto: CreateWarehouseDto): Promise<WarehouseRow> {
    const { companyId, branchId } = await this.resolveMembership(user);
    if (branchId && dto.branchId && dto.branchId !== branchId) throw new ForbiddenException('You can only create warehouses in your assigned branch.');
    const targetBranchId = branchId ?? dto.branchId ?? null;
    const code = dto.code.trim().toUpperCase();
    const name = dto.name.trim();
    if (!code) throw new BadRequestException('Warehouse code cannot be empty.');
    if (!name) throw new BadRequestException('Warehouse name cannot be empty.');
    if (targetBranchId) await this.assertBranch(companyId, targetBranchId);
    const exists = await this.db.query<{ id: string }>(
      'SELECT id FROM warehouses WHERE company_id=$1 AND UPPER(code)=UPPER($2)', [companyId, code],
    );
    if (exists.rows.length) throw new ConflictException('A warehouse with this code already exists.');
    try {
      return await this.db.transaction(async client => {
        const result = await client.query<WarehouseRow>(
          `INSERT INTO warehouses(company_id,branch_id,code,name,location,capacity,is_active)
           VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [companyId,targetBranchId,code,name,dto.location?.trim() || null,dto.capacity ?? 0,dto.isActive ?? true],
        );
        const warehouse = result.rows[0];
        await this.audit.logInTransaction(client,{userId:user.userId,companyId,branchId:targetBranchId,action:'inventory.warehouse.create',entityType:'warehouse',entityId:warehouse.id,oldValues:null,newValues:{code:warehouse.code,name:warehouse.name},ipAddress:null});
        return warehouse;
      });
    } catch (error) {
      const databaseError = error as { code?: string };
      if (databaseError.code === '23505') throw new ConflictException('A warehouse with this code already exists.');
      throw error;
    }
  }

  async updateWarehouse(user: AuthenticatedUser, warehouseId: string, dto: UpdateWarehouseDto): Promise<WarehouseRow> {
    const { companyId, branchId } = await this.resolveMembership(user);
    const existing = await this.getWarehouse(user, warehouseId);
    if (branchId && existing.branch_id !== branchId) throw new ForbiddenException('You can only manage warehouses in your assigned branch.');
    if (branchId && 'branchId' in dto && dto.branchId !== branchId) throw new ForbiddenException('You cannot move a warehouse outside your assigned branch.');
    if (dto.branchId) await this.assertBranch(companyId, dto.branchId);
    if (typeof dto.code === 'string') {
      const normalizedCode = dto.code.trim().toUpperCase();
      if (!normalizedCode) throw new BadRequestException('Warehouse code cannot be empty.');
      const duplicate = await this.db.query<{ id: string }>(
        'SELECT id FROM warehouses WHERE company_id=$1 AND UPPER(code)=UPPER($2) AND id<>$3',
        [companyId, normalizedCode, warehouseId],
      );
      if (duplicate.rows.length) throw new ConflictException('A warehouse with this code already exists.');
    }
    if (typeof dto.name === 'string' && !dto.name.trim()) {
      throw new BadRequestException('Warehouse name cannot be empty.');
    }
    const map: Record<string,string> = { code:'code',name:'name',location:'location',branchId:'branch_id',capacity:'capacity',isActive:'is_active' };
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key,column] of Object.entries(map)) {
      if (key in dto) {
        const value = (dto as Record<string,unknown>)[key];
        values.push(
          typeof value === 'string' && (key === 'code' || key === 'name' || key === 'location')
            ? (key === 'code' ? value.trim().toUpperCase() : value.trim() || null)
            : value,
        );
        fields.push(`${column}=$${values.length}`);
      }
    }
    if (!fields.length) return existing;
    fields.push('updated_at=NOW()');
    values.push(warehouseId,companyId,branchId);
    try {
      return await this.db.transaction(async client => {
        if (dto.branchId && dto.branchId !== existing.branch_id) {
          const lockedWarehouse = await client.query<{ id: string }>(
            'SELECT id FROM warehouses WHERE id=$1 AND company_id=$2 FOR UPDATE',
            [warehouseId, companyId],
          );
          if (!lockedWarehouse.rows[0]) throw new NotFoundException('Warehouse not found.');
          const stockHistory = await client.query<{ id: string }>(
            'SELECT id FROM inventory_stock_levels WHERE company_id=$1 AND warehouse_id=$2 LIMIT 1',
            [companyId, warehouseId],
          );
          const movementHistory = await client.query<{ id: string }>(
            'SELECT id FROM inventory_stock_movements WHERE company_id=$1 AND warehouse_id=$2 LIMIT 1',
            [companyId, warehouseId],
          );
          const countHistory = await client.query<{ id: string }>(
            'SELECT id FROM inventory_stocktakes WHERE company_id=$1 AND warehouse_id=$2 LIMIT 1',
            [companyId, warehouseId],
          );
          if (stockHistory.rows.length || movementHistory.rows.length || countHistory.rows.length) {
            throw new ConflictException('A warehouse with stock records or movement history cannot be reassigned to another branch.');
          }
        }
        if (dto.isActive === false && existing.is_active) {
          const lockedWarehouse = await client.query<{ id: string }>(
            'SELECT id FROM warehouses WHERE id=$1 AND company_id=$2 AND ($3::uuid IS NULL OR branch_id=$3) FOR UPDATE',
            [warehouseId, companyId, branchId],
          );
          if (!lockedWarehouse.rows[0]) throw new NotFoundException('Warehouse not found.');
          const occupied = await client.query<{ id: string }>(
            'SELECT id FROM inventory_stock_levels WHERE company_id=$1 AND warehouse_id=$2 AND (quantity>0 OR reserved_quantity>0) FOR UPDATE',
            [companyId, warehouseId],
          );
          if (occupied.rows.length) {
            throw new ConflictException('Move or release all on-hand and reserved stock before deactivating this warehouse.');
          }
        }
        const result = await client.query<WarehouseRow>(
          `UPDATE warehouses SET ${fields.join(',')} WHERE id=${values.length-2} AND company_id=${values.length-1} AND (${values.length}::uuid IS NULL OR branch_id=${values.length}) RETURNING *`, values as (string|number|boolean|null)[],
        );
        if (!result.rows[0]) throw new NotFoundException('Warehouse not found.');
        await this.audit.logInTransaction(client,{userId:user.userId,companyId,branchId:result.rows[0].branch_id,action:'inventory.warehouse.update',entityType:'warehouse',entityId:warehouseId,oldValues:{name:existing.name,code:existing.code},newValues:{name:result.rows[0].name,code:result.rows[0].code},ipAddress:null});
        return result.rows[0];
      });
    } catch (error) {
      const databaseError = error as { code?: string };
      if (databaseError.code === '23505') throw new ConflictException('A warehouse with this code already exists.');
      throw error;
    }
  }

  async listStock(user: AuthenticatedUser, warehouseId?: string, search?: string): Promise<StockRow[]> {
    const { companyId, branchId } = await this.resolveMembership(user);
    const values: (string|number|null)[] = [companyId, branchId];
    let filters = 's.company_id=$1 AND ($2::uuid IS NULL OR w.branch_id=$2)';
    if (warehouseId) { values.push(warehouseId); filters += ` AND s.warehouse_id=$${values.length}`; }
    if (search?.trim()) { values.push(`%${search.trim()}%`); filters += ` AND (p.name ILIKE $${values.length} OR p.sku ILIKE $${values.length} OR w.name ILIKE $${values.length})`; }
    const result = await this.db.query<StockRow>(
      `SELECT s.*,w.name AS warehouse_name,w.code AS warehouse_code,p.sku,p.name AS product_name,p.unit,p.cost_price,p.selling_price,
        (s.quantity-s.reserved_quantity) AS available_quantity,
        CASE WHEN s.quantity-s.reserved_quantity<=0 THEN 'out_of_stock' WHEN s.quantity-s.reserved_quantity<=s.reorder_level THEN 'low_stock' ELSE 'in_stock' END AS status
       FROM inventory_stock_levels s JOIN warehouses w ON w.id=s.warehouse_id AND w.company_id=s.company_id
       JOIN products p ON p.id=s.product_id AND p.company_id=s.company_id
       WHERE ${filters} ORDER BY p.name,w.name`, values,
    );
    return result.rows;
  }

  async listMovements(user: AuthenticatedUser, limit?: string): Promise<MovementRow[]> {
    const { companyId, branchId } = await this.resolveMembership(user);
    const parsed = Number.parseInt(limit ?? '100', 10);
    const safeLimit = Number.isFinite(parsed) ? Math.max(1,Math.min(parsed,250)) : 100;
    const result = await this.db.query<MovementRow>(
      `SELECT m.*,p.name AS product_name,p.sku,w.name AS warehouse_name
       FROM inventory_stock_movements m JOIN products p ON p.id=m.product_id AND p.company_id=m.company_id
       JOIN warehouses w ON w.id=m.warehouse_id AND w.company_id=m.company_id
       WHERE m.company_id=$1 AND ($2::uuid IS NULL OR w.branch_id=$2) ORDER BY m.created_at DESC LIMIT $3`, [companyId,branchId,safeLimit],
    );
    return result.rows;
  }

  async summary(user: AuthenticatedUser) {
    const { companyId, branchId } = await this.resolveMembership(user);
    const result = await this.db.query<Record<string, string|number>>(
      `SELECT COUNT(DISTINCT s.product_id)::int AS stocked_products,
        COUNT(*) FILTER(WHERE s.quantity-s.reserved_quantity>0 AND s.quantity-s.reserved_quantity<=s.reorder_level)::int AS low_stock_lines,
        COUNT(*) FILTER(WHERE s.quantity-s.reserved_quantity<=0)::int AS out_of_stock_lines,
        COALESCE(SUM(s.quantity*s.average_unit_cost),0) AS inventory_cost_value,
        (SELECT COUNT(*)::int FROM warehouses WHERE company_id=$1 AND is_active=true AND ($2::uuid IS NULL OR branch_id=$2)) AS active_warehouses,
        (SELECT COUNT(*)::int FROM inventory_stock_movements m JOIN warehouses mw ON mw.id=m.warehouse_id AND mw.company_id=m.company_id WHERE m.company_id=$1 AND ($2::uuid IS NULL OR mw.branch_id=$2) AND m.created_at >= NOW()-INTERVAL '30 days') AS movements_last_30_days
       FROM inventory_stock_levels s JOIN products p ON p.id=s.product_id AND p.company_id=s.company_id
       JOIN warehouses w ON w.id=s.warehouse_id AND w.company_id=s.company_id
       WHERE s.company_id=$1 AND ($2::uuid IS NULL OR w.branch_id=$2) AND p.is_service=false`, [companyId, branchId],
    );
    return result.rows[0];
  }

  async reconciliation(user: AuthenticatedUser) {
    const { companyId, branchId } = await this.resolveMembership(user);
    if (branchId) throw new ForbiddenException('Inventory reconciliation is available to company-wide roles only.');
    const [ledger, legacy, valuation] = await Promise.all([
      this.db.query<{ mismatch_count: string | number; absolute_quantity_variance: string | number }>(
        `WITH movement_totals AS (
           SELECT company_id,warehouse_id,product_id,SUM(quantity) AS quantity
           FROM inventory_stock_movements WHERE company_id=$1 GROUP BY company_id,warehouse_id,product_id
         ), compared AS (
           SELECT COALESCE(s.company_id,m.company_id) AS company_id,
             COALESCE(s.warehouse_id,m.warehouse_id) AS warehouse_id,
             COALESCE(s.product_id,m.product_id) AS product_id,
             COALESCE(s.quantity,0)-COALESCE(m.quantity,0) AS variance
           FROM inventory_stock_levels s
           FULL OUTER JOIN movement_totals m
             ON m.company_id=s.company_id AND m.warehouse_id=s.warehouse_id AND m.product_id=s.product_id
           WHERE COALESCE(s.company_id,m.company_id)=$1
         )
         SELECT COUNT(*) FILTER(WHERE ABS(variance)>0.0005)::int AS mismatch_count,
           COALESCE(SUM(ABS(variance)),0)::numeric(16,3) AS absolute_quantity_variance
         FROM compared`, [companyId],
      ),
      this.db.query<{ mismatch_count: string | number; absolute_quantity_variance: string | number }>(
        `SELECT COUNT(*) FILTER(WHERE ABS(COALESCE(p.stock_quantity,0)-COALESCE(s.quantity,0))>0.0005)::int AS mismatch_count,
           COALESCE(SUM(ABS(COALESCE(p.stock_quantity,0)-COALESCE(s.quantity,0))),0)::numeric(16,3) AS absolute_quantity_variance
         FROM products p
         LEFT JOIN (SELECT company_id,product_id,SUM(quantity) AS quantity
           FROM inventory_stock_levels WHERE company_id=$1 GROUP BY company_id,product_id) s
           ON s.company_id=p.company_id AND s.product_id=p.id
         WHERE p.company_id=$1 AND p.is_service=false`, [companyId],
      ),
      this.db.query<{ stock_cost_value: string | number; inventory_account_balance: string | number }>(
        `SELECT
           COALESCE((SELECT SUM(ROUND(s.quantity*s.average_unit_cost,2))
             FROM inventory_stock_levels s JOIN products p ON p.id=s.product_id AND p.company_id=s.company_id
             WHERE s.company_id=$1 AND p.is_service=false),0)::numeric(16,2) AS stock_cost_value,
           COALESCE((SELECT SUM(l.debit-l.credit)
             FROM chart_of_accounts a
             JOIN journal_entry_lines l ON l.account_id=a.id AND l.company_id=a.company_id
             JOIN journal_entries j ON j.id=l.journal_entry_id AND j.company_id=l.company_id
             WHERE a.company_id=$1 AND a.system_code='inventory' AND j.status='posted'),0)::numeric(16,2) AS inventory_account_balance`,
        [companyId],
      ),
    ]);
    const ledgerRow=ledger.rows[0];
    const legacyRow=legacy.rows[0];
    const stockCostValue=Number(valuation.rows[0]?.stock_cost_value ?? 0);
    const inventoryAccountBalance=Number(valuation.rows[0]?.inventory_account_balance ?? 0);
    const valuationVariance=Math.round((stockCostValue-inventoryAccountBalance)*100)/100;
    const movementMismatchCount=Number(ledgerRow?.mismatch_count ?? 0);
    const legacyMismatchCount=Number(legacyRow?.mismatch_count ?? 0);
    return {
      companyId,
      checkedAt:new Date().toISOString(),
      stockLedger:{mismatchCount:movementMismatchCount,absoluteQuantityVariance:Number(ledgerRow?.absolute_quantity_variance ?? 0),reconciled:movementMismatchCount===0},
      legacyProductQuantities:{mismatchCount:legacyMismatchCount,absoluteQuantityVariance:Number(legacyRow?.absolute_quantity_variance ?? 0),reconciled:legacyMismatchCount===0},
      valuation:{basis:'weighted_average_cost',stockCostValue,inventoryAccountBalance,variance:valuationVariance,reconciled:Math.abs(valuationVariance)<=0.01},
    };
  }


  async listStocktakes(user: AuthenticatedUser) {
    const { companyId, branchId } = await this.resolveMembership(user);
    const result = await this.db.query(
      "SELECT t.id,t.warehouse_id,t.reference,t.status,t.notes,t.created_at,t.posted_at,w.code AS warehouse_code,w.name AS warehouse_name,u.full_name AS created_by_name,COUNT(l.id)::int AS line_count,COUNT(l.id) FILTER(WHERE l.counted_quantity IS NOT NULL)::int AS counted_lines FROM inventory_stocktakes t JOIN warehouses w ON w.id=t.warehouse_id AND w.company_id=t.company_id LEFT JOIN users u ON u.id=t.created_by LEFT JOIN inventory_stocktake_lines l ON l.stocktake_id=t.id AND l.company_id=t.company_id WHERE t.company_id=$1 AND ($2::uuid IS NULL OR w.branch_id=$2) GROUP BY t.id,w.code,w.name,u.full_name ORDER BY t.created_at DESC LIMIT 100",
      [companyId, branchId],
    );
    return result.rows;
  }

  async getStocktake(user: AuthenticatedUser, stocktakeId: string) {
    const { companyId, branchId } = await this.resolveMembership(user);
    const header = await this.db.query("SELECT t.*,w.code AS warehouse_code,w.name AS warehouse_name FROM inventory_stocktakes t JOIN warehouses w ON w.id=t.warehouse_id AND w.company_id=t.company_id WHERE t.id=$1 AND t.company_id=$2 AND ($3::uuid IS NULL OR w.branch_id=$3)", [stocktakeId, companyId, branchId]);
    if (!header.rows[0]) throw new NotFoundException('Stocktake not found.');
    const lines = await this.db.query("SELECT l.id,l.product_id,l.snapshot_quantity,l.counted_quantity,l.counted_at,l.average_unit_cost,l.notes,p.sku,p.name AS product_name,p.unit FROM inventory_stocktake_lines l JOIN products p ON p.id=l.product_id AND p.company_id=l.company_id WHERE l.stocktake_id=$1 AND l.company_id=$2 ORDER BY p.name", [stocktakeId, companyId]);
    return { ...header.rows[0], lines: lines.rows };
  }

  async createStocktake(user: AuthenticatedUser, dto: CreateStocktakeDto) {
    const { companyId, branchId } = await this.resolveMembership(user);
    const id = await this.db.transaction(async client => {
      const warehouse = await client.query("SELECT id,branch_id FROM warehouses WHERE id=$1 AND company_id=$2 AND is_active=true AND ($3::uuid IS NULL OR branch_id=$3) FOR SHARE", [dto.warehouseId, companyId, branchId]);
      if (!warehouse.rows[0]) throw new NotFoundException('Active warehouse not found in your company and assigned branch.');
      const existing = await client.query("SELECT id FROM inventory_stocktakes WHERE company_id=$1 AND warehouse_id=$2 AND status='draft' FOR UPDATE", [companyId, dto.warehouseId]);
      if (existing.rows.length) throw new ConflictException('This warehouse already has an open stocktake.');
      const inserted = await client.query("INSERT INTO inventory_stocktakes(company_id,branch_id,warehouse_id,reference,notes,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id", [companyId, warehouse.rows[0].branch_id, dto.warehouseId, dto.reference?.trim() || null, dto.notes?.trim() || null, user.userId]);
      const stocktakeId = inserted.rows[0].id;
      await client.query("INSERT INTO inventory_stocktake_lines(company_id,stocktake_id,product_id,snapshot_quantity,average_unit_cost) SELECT $1,$2,p.id,COALESCE(s.quantity,0),COALESCE(s.average_unit_cost,0) FROM products p LEFT JOIN inventory_stock_levels s ON s.company_id=p.company_id AND s.product_id=p.id AND s.warehouse_id=$3 WHERE p.company_id=$1 AND p.is_active=true AND p.is_service=false", [companyId, stocktakeId, dto.warehouseId]);
      await this.audit.logInTransaction(client,{userId:user.userId,companyId,branchId:warehouse.rows[0].branch_id,action:'inventory.stocktake.create',entityType:'inventory_stocktake',entityId:stocktakeId,oldValues:null,newValues:{warehouseId:dto.warehouseId,reference:dto.reference ?? null},ipAddress:null});
      return stocktakeId;
    });
    return this.getStocktake(user, id);
  }

  async countStocktakeLine(user: AuthenticatedUser, stocktakeId: string, lineId: string, dto: CountStocktakeLineDto) {
    const { companyId, branchId } = await this.resolveMembership(user);
    return this.db.transaction(async client => {
      const session = await client.query("SELECT t.id,t.status FROM inventory_stocktakes t JOIN warehouses w ON w.id=t.warehouse_id AND w.company_id=t.company_id WHERE t.id=$1 AND t.company_id=$2 AND ($3::uuid IS NULL OR w.branch_id=$3) FOR UPDATE OF t", [stocktakeId, companyId, branchId]);
      if (!session.rows[0]) throw new NotFoundException('Stocktake not found.');
      if (session.rows[0].status !== 'draft') throw new ConflictException('Only draft stocktakes can be counted.');
      const updated = await client.query("UPDATE inventory_stocktake_lines SET counted_quantity=$1,counted_at=NOW(),notes=$2,updated_at=NOW() WHERE id=$3 AND stocktake_id=$4 AND company_id=$5 RETURNING id,counted_quantity,counted_at,notes", [dto.countedQuantity, dto.notes?.trim() || null, lineId, stocktakeId, companyId]);
      if (!updated.rows[0]) throw new NotFoundException('Stocktake line not found.');
      await this.audit.logInTransaction(client,{userId:user.userId,companyId,branchId,action:'inventory.stocktake.count',entityType:'inventory_stocktake_line',entityId:lineId,oldValues:null,newValues:{countedQuantity:dto.countedQuantity},ipAddress:null});
      return updated.rows[0];
    });
  }

  async postStocktake(user: AuthenticatedUser, stocktakeId: string) {
    const { companyId, branchId } = await this.resolveMembership(user);
    await this.db.transaction(async client => {
      const warehouseAccess = await client.query("SELECT w.id FROM inventory_stocktakes t JOIN warehouses w ON w.id=t.warehouse_id AND w.company_id=t.company_id WHERE t.id=$1 AND t.company_id=$2 AND ($3::uuid IS NULL OR w.branch_id=$3) AND w.is_active=true FOR SHARE OF w", [stocktakeId, companyId, branchId]);
      if (!warehouseAccess.rows[0]) throw new NotFoundException('Active stocktake warehouse not found in your company and assigned branch.');
      const session = await client.query("SELECT id,status,warehouse_id,branch_id,reference FROM inventory_stocktakes WHERE id=$1 AND company_id=$2 FOR UPDATE", [stocktakeId, companyId]);
      if (!session.rows[0]) throw new NotFoundException('Stocktake not found.');
      if (session.rows[0].status !== 'draft') throw new ConflictException('This stocktake has already been posted or cancelled.');
      const lines = await client.query("SELECT l.id,l.product_id,l.counted_quantity,l.counted_at,p.name AS product_name,p.cost_price,p.unit FROM inventory_stocktake_lines l JOIN products p ON p.id=l.product_id AND p.company_id=l.company_id WHERE l.stocktake_id=$1 AND l.company_id=$2 ORDER BY l.product_id FOR UPDATE OF l", [stocktakeId, companyId]);
      if (!lines.rows.length) throw new ConflictException('This stocktake has no count lines.');
      if (lines.rows.some(line => line.counted_quantity === null || !line.counted_at)) throw new ConflictException('Count every stocktake line before posting.');
      for (const line of lines.rows) {
        await this.ensureStockRow(client, companyId, session.rows[0].warehouse_id, line.product_id);
        const current = await client.query("SELECT quantity,reserved_quantity,average_unit_cost FROM inventory_stock_levels WHERE company_id=$1 AND warehouse_id=$2 AND product_id=$3 FOR UPDATE", [companyId, session.rows[0].warehouse_id, line.product_id]);
        const changed = await client.query("SELECT id FROM inventory_stock_movements WHERE company_id=$1 AND warehouse_id=$2 AND product_id=$3 AND created_at>=$4 LIMIT 1", [companyId, session.rows[0].warehouse_id, line.product_id, line.counted_at]);
        if (changed.rows.length) throw new ConflictException('Stock for ' + line.product_name + ' moved after it was counted. Recount this line before posting.');
        const delta = Number(line.counted_quantity) - Number(current.rows[0].quantity);
        if (Math.abs(delta) < 0.00005) continue;
        if (Number(line.counted_quantity) < Number(current.rows[0].reserved_quantity)) throw new ConflictException('Counted quantity for ' + line.product_name + ' is below its reserved quantity.');
        let unitCost = Number(current.rows[0].average_unit_cost ?? 0);
        if (delta > 0 && unitCost <= 0) unitCost = Number(line.cost_price ?? 0);
        if (delta > 0 && unitCost <= 0) throw new BadRequestException('A positive cost is required to post the stock increase for ' + line.product_name + '.');
        if (delta > 0) {
          await client.query("UPDATE inventory_stock_levels SET average_unit_cost=CASE WHEN quantity+$1>0 THEN ((quantity*average_unit_cost)+($1*$2))/(quantity+$1) ELSE $2 END,quantity=$3,updated_at=NOW() WHERE company_id=$4 AND warehouse_id=$5 AND product_id=$6", [delta, unitCost, line.counted_quantity, companyId, session.rows[0].warehouse_id, line.product_id]);
        } else {
          await client.query("UPDATE inventory_stock_levels SET quantity=$1,updated_at=NOW() WHERE company_id=$2 AND warehouse_id=$3 AND product_id=$4", [line.counted_quantity, companyId, session.rows[0].warehouse_id, line.product_id]);
        }
        const movement = await this.insertMovement(client,{companyId,productId:line.product_id,warehouseId:session.rows[0].warehouse_id,type:'adjustment',quantity:delta,unitCost,reference:session.rows[0].reference || 'STOCKTAKE-' + stocktakeId,notes:'Stocktake variance: counted ' + line.counted_quantity + ' ' + line.unit,userId:user.userId});
        await this.postMovementJournal(client,{companyId,userId:user.userId,movementId:movement.id,quantity:delta,unitCost,description:'Stocktake variance ' + (session.rows[0].reference || stocktakeId)});
        await this.syncLegacyProductQuantity(client,companyId,line.product_id);
      }
      await client.query("UPDATE inventory_stocktakes SET status='posted',posted_at=NOW(),posted_by=$1,updated_at=NOW() WHERE id=$2 AND company_id=$3", [user.userId, stocktakeId, companyId]);
      await this.audit.logInTransaction(client,{userId:user.userId,companyId,branchId:session.rows[0].branch_id,action:'inventory.stocktake.post',entityType:'inventory_stocktake',entityId:stocktakeId,oldValues:{status:'draft'},newValues:{status:'posted'},ipAddress:null});
    });
    return this.getStocktake(user, stocktakeId);
  }

  async cancelStocktake(user: AuthenticatedUser, stocktakeId: string) {
    const { companyId, branchId } = await this.resolveMembership(user);
    return this.db.transaction(async client => {
      const result = await client.query("UPDATE inventory_stocktakes t SET status='cancelled',updated_at=NOW() FROM warehouses w WHERE t.warehouse_id=w.id AND t.company_id=w.company_id AND t.id=$1 AND t.company_id=$2 AND ($3::uuid IS NULL OR w.branch_id=$3) AND t.status='draft' RETURNING t.id,t.status", [stocktakeId, companyId, branchId]);
      if (!result.rows[0]) throw new ConflictException('Draft stocktake not found or already closed.');
      await this.audit.logInTransaction(client,{userId:user.userId,companyId,branchId,action:'inventory.stocktake.cancel',entityType:'inventory_stocktake',entityId:stocktakeId,oldValues:{status:'draft'},newValues:{status:'cancelled'},ipAddress:null});
      return result.rows[0];
    });
  }

  receive(user: AuthenticatedUser, dto: CreateStockMovementDto) {
    return this.postSingleMovement(user,dto,'receipt',dto.quantity);
  }

  issue(user: AuthenticatedUser, dto: CreateStockMovementDto) {
    return this.postSingleMovement(user,dto,'issue',-dto.quantity);
  }

  async adjust(user: AuthenticatedUser, dto: AdjustStockDto) {
    const { companyId, branchId } = await this.resolveMembership(user);
    const result = await this.db.transaction(async client => {
      await this.assertProduct(client,companyId,dto.productId);
      await this.assertWarehouse(client,companyId,dto.warehouseId,branchId);
      await this.ensureStockRow(client,companyId,dto.warehouseId,dto.productId);
      const stock = await client.query<{quantity:string;reserved_quantity:string;average_unit_cost:string|number}>(
        'SELECT quantity,reserved_quantity,average_unit_cost FROM inventory_stock_levels WHERE company_id=$1 AND warehouse_id=$2 AND product_id=$3 FOR UPDATE',
        [companyId,dto.warehouseId,dto.productId],
      );
      const oldQuantity = Number(stock.rows[0].quantity);
      const delta = Number(dto.newQuantity)-oldQuantity;
      if (Math.abs(delta)<0.00005) throw new BadRequestException('The adjusted quantity matches the current stock.');
      if (Number(dto.newQuantity)<Number(stock.rows[0].reserved_quantity)) throw new BadRequestException('Adjusted stock cannot be lower than reserved stock.');
      const adjustmentCost=delta>0 ? Number(dto.unitCost ?? stock.rows[0].average_unit_cost) : Number(stock.rows[0].average_unit_cost);
      if(delta>0 && dto.unitCost===undefined && adjustmentCost<=0){
        throw new BadRequestException('A unit cost is required when increasing stock without an existing positive average cost.');
      }
      if(delta>0){
        await client.query(
          `UPDATE inventory_stock_levels
           SET average_unit_cost=CASE WHEN quantity+$1>0 THEN ((quantity*average_unit_cost)+($1*$2))/(quantity+$1) ELSE $2 END,
               quantity=$3,updated_at=NOW()
           WHERE company_id=$4 AND warehouse_id=$5 AND product_id=$6`,
          [delta,adjustmentCost,dto.newQuantity,companyId,dto.warehouseId,dto.productId],
        );
      } else {
        await client.query('UPDATE inventory_stock_levels SET quantity=$1,updated_at=NOW() WHERE company_id=$2 AND warehouse_id=$3 AND product_id=$4',[dto.newQuantity,companyId,dto.warehouseId,dto.productId]);
      }
      const movement = await this.insertMovement(client,{companyId,productId:dto.productId,warehouseId:dto.warehouseId,type:'adjustment',quantity:delta,unitCost:adjustmentCost,reference:dto.reference,notes:dto.notes,userId:user.userId});
      await this.postMovementJournal(client,{companyId,userId:user.userId,movementId:movement.id,quantity:delta,unitCost:adjustmentCost,description:`Inventory adjustment ${dto.reference?.trim() || movement.id}`});
      await this.syncLegacyProductQuantity(client,companyId,dto.productId);
      await this.logMovement(client,user,companyId,branchId,movement.id,'inventory.stock.adjust',{productId:dto.productId,warehouseId:dto.warehouseId,quantity:dto.newQuantity});
      return movement;
    });
    return result;
  }

  async transfer(user: AuthenticatedUser, dto: TransferStockDto) {
    const { companyId, branchId } = await this.resolveMembership(user);
    if (dto.sourceWarehouseId===dto.destinationWarehouseId) throw new BadRequestException('Choose two different warehouses.');
    const transferGroupId = randomUUID();
    const result = await this.db.transaction(async client => {
      await this.assertProduct(client,companyId,dto.productId);
      await this.assertWarehouse(client,companyId,dto.sourceWarehouseId,branchId);
      await this.assertWarehouse(client,companyId,dto.destinationWarehouseId,branchId);
      await this.ensureStockRow(client,companyId,dto.sourceWarehouseId,dto.productId);
      await this.ensureStockRow(client,companyId,dto.destinationWarehouseId,dto.productId);
      const ids=[dto.sourceWarehouseId,dto.destinationWarehouseId].sort();
      for (const id of ids) await client.query(
        'SELECT quantity FROM inventory_stock_levels WHERE company_id=$1 AND warehouse_id=$2 AND product_id=$3 FOR UPDATE',
        [companyId,id,dto.productId],
      );
      const source=await client.query<{quantity:string;reserved_quantity:string;average_unit_cost:string|number}>(
        'SELECT quantity,reserved_quantity,average_unit_cost FROM inventory_stock_levels WHERE company_id=$1 AND warehouse_id=$2 AND product_id=$3',
        [companyId,dto.sourceWarehouseId,dto.productId],
      );
      if (Number(source.rows[0].quantity)-Number(source.rows[0].reserved_quantity)<dto.quantity) throw new BadRequestException('Insufficient available stock in the source warehouse.');
      await client.query('UPDATE inventory_stock_levels SET quantity=quantity-$1,updated_at=NOW() WHERE company_id=$2 AND warehouse_id=$3 AND product_id=$4',[dto.quantity,companyId,dto.sourceWarehouseId,dto.productId]);
      const sourceCostResult=await client.query<{average_unit_cost:string|number}>('SELECT average_unit_cost FROM inventory_stock_levels WHERE company_id=$1 AND warehouse_id=$2 AND product_id=$3',[companyId,dto.sourceWarehouseId,dto.productId]);
      const transferCost=Number(sourceCostResult.rows[0]?.average_unit_cost ?? dto.unitCost ?? 0);
      await client.query(
        `UPDATE inventory_stock_levels
         SET average_unit_cost=CASE WHEN quantity+$1>0 THEN ((quantity*average_unit_cost)+($1*$2))/(quantity+$1) ELSE $2 END,
             quantity=quantity+$1,updated_at=NOW()
         WHERE company_id=$3 AND warehouse_id=$4 AND product_id=$5`,
        [dto.quantity,transferCost,companyId,dto.destinationWarehouseId,dto.productId],
      );
      const out=await this.insertMovement(client,{companyId,productId:dto.productId,warehouseId:dto.sourceWarehouseId,type:'transfer_out',quantity:-dto.quantity,unitCost:transferCost,reference:dto.reference,notes:dto.notes,userId:user.userId,transferGroupId});
      const into=await this.insertMovement(client,{companyId,productId:dto.productId,warehouseId:dto.destinationWarehouseId,type:'transfer_in',quantity:dto.quantity,unitCost:transferCost,reference:dto.reference,notes:dto.notes,userId:user.userId,transferGroupId});
      await this.syncLegacyProductQuantity(client,companyId,dto.productId);
      await this.logMovement(client,user,companyId,branchId,transferGroupId,'inventory.stock.transfer',{productId:dto.productId,sourceWarehouseId:dto.sourceWarehouseId,destinationWarehouseId:dto.destinationWarehouseId,quantity:dto.quantity});
      return {transferGroupId,sourceMovement:out,destinationMovement:into};
    });
    return result;
  }

  async listReturns(user: AuthenticatedUser) {
    const { companyId, branchId } = await this.resolveMembership(user);
    return (await this.db.query(
      `SELECT r.*, c.name AS customer_name, s.name AS supplier_name, w.name AS warehouse_name,
        (SELECT COUNT(*)::int FROM inventory_return_lines l WHERE l.company_id=r.company_id AND l.return_id=r.id) AS line_count
       FROM inventory_returns r
       LEFT JOIN customers c ON c.id=r.customer_id AND c.company_id=r.company_id
       LEFT JOIN suppliers s ON s.id=r.supplier_id AND s.company_id=r.company_id
       JOIN warehouses w ON w.id=r.warehouse_id AND w.company_id=r.company_id
       WHERE r.company_id=$1 AND ($2::uuid IS NULL OR r.branch_id=$2)
       ORDER BY r.created_at DESC LIMIT 250`, [companyId, branchId],
    )).rows;
  }

  async createReturn(user: AuthenticatedUser, dto: CreateInventoryReturnDto) {
    const { companyId, branchId } = await this.resolveMembership(user);
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('A return reason is required.');
    if (dto.returnType === 'customer' && (!dto.customerId || dto.supplierId)) {
      throw new BadRequestException('A customer return must identify one customer only.');
    }
    if (dto.returnType === 'supplier' && (!dto.supplierId || dto.customerId)) {
      throw new BadRequestException('A supplier return must identify one supplier only.');
    }
    const lines = dto.items.map(item => {
      const disposition = item.disposition;
      if (dto.returnType === 'supplier' && disposition !== 'return_to_supplier') {
        throw new BadRequestException('Supplier returns must be dispatched back to the supplier.');
      }
      if (dto.returnType === 'customer' && disposition === 'return_to_supplier') {
        throw new BadRequestException('Customer returns cannot use the supplier-return disposition.');
      }
      if (!Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unitCost) || item.unitCost < 0) {
        throw new BadRequestException('Return quantities and unit costs must be valid non-negative values.');
      }
      return item;
    });
    const returnId = await this.db.transaction(async client => {
      await this.assertWarehouse(client, companyId, dto.warehouseId, branchId);
      if (dto.returnType === 'customer') {
        const party = await client.query<{ id: string }>(
          'SELECT id FROM customers WHERE id=$1 AND company_id=$2 AND is_active=true FOR SHARE',
          [dto.customerId!, companyId],
        );
        if (!party.rows[0]) throw new NotFoundException('Active customer not found in this company.');
      } else {
        const party = await client.query<{ id: string }>(
          'SELECT id FROM suppliers WHERE id=$1 AND company_id=$2 AND is_active=true FOR SHARE',
          [dto.supplierId!, companyId],
        );
        if (!party.rows[0]) throw new NotFoundException('Active supplier not found in this company.');
      }
      for (const line of lines) await this.assertProduct(client, companyId, line.productId);
      const number = `IR-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
      const header = await client.query<{ id: string }>(
        `INSERT INTO inventory_returns
          (company_id,branch_id,return_number,return_type,customer_id,supplier_id,warehouse_id,source_reference,reason,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [companyId, branchId, number, dto.returnType, dto.customerId ?? null, dto.supplierId ?? null,
          dto.warehouseId, dto.sourceReference?.trim() || null, reason, user.userId],
      );
      for (const line of lines) {
        await client.query(
          `INSERT INTO inventory_return_lines(company_id,return_id,product_id,quantity,unit_cost,disposition,inspection_notes)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [companyId, header.rows[0].id, line.productId, line.quantity, line.unitCost, line.disposition, line.inspectionNotes?.trim() || null],
        );
      }
      await this.audit.logInTransaction(client, {
        userId: user.userId, companyId, branchId, action: 'inventory.return.create',
        entityType: 'inventory_return', entityId: header.rows[0].id, oldValues: null,
        newValues: { returnNumber: number, returnType: dto.returnType, lineCount: lines.length }, ipAddress: null,
      });
      return header.rows[0].id;
    });
    return this.getReturn(user, returnId);
  }

  async getReturn(user: AuthenticatedUser, returnId: string) {
    const { companyId, branchId } = await this.resolveMembership(user);
    const header = await this.db.query(
      `SELECT r.*, c.name AS customer_name, s.name AS supplier_name, w.name AS warehouse_name
       FROM inventory_returns r
       LEFT JOIN customers c ON c.id=r.customer_id AND c.company_id=r.company_id
       LEFT JOIN suppliers s ON s.id=r.supplier_id AND s.company_id=r.company_id
       JOIN warehouses w ON w.id=r.warehouse_id AND w.company_id=r.company_id
       WHERE r.company_id=$1 AND r.id=$2 AND ($3::uuid IS NULL OR r.branch_id=$3)`,
      [companyId, returnId, branchId],
    );
    if (!header.rows[0]) throw new NotFoundException('Inventory return not found.');
    const lines = await this.db.query(
      `SELECT l.*,p.name AS product_name,p.sku
       FROM inventory_return_lines l JOIN products p ON p.id=l.product_id AND p.company_id=l.company_id
       WHERE l.company_id=$1 AND l.return_id=$2 ORDER BY l.created_at,l.id`,
      [companyId, returnId],
    );
    return { ...header.rows[0], items: lines.rows };
  }

  async postReturn(user: AuthenticatedUser, returnId: string) {
    const { companyId, branchId } = await this.resolveMembership(user);
    let supplierReturnValue = 0;
    await this.db.transaction(async client => {
      const result = await client.query<{
        id: string; return_number: string; return_type: 'customer' | 'supplier'; warehouse_id: string;
        status: string; branch_id: string | null;
      }>(
        'SELECT id,return_number,return_type,warehouse_id,status,branch_id FROM inventory_returns WHERE id=$1 AND company_id=$2 AND ($3::uuid IS NULL OR branch_id=$3) FOR UPDATE',
        [returnId, companyId, branchId],
      );
      const header = result.rows[0];
      if (!header) throw new NotFoundException('Inventory return not found.');
      if (header.status !== 'draft') throw new ConflictException('Only draft returns can be posted.');
      await this.assertWarehouse(client, companyId, header.warehouse_id, branchId);
      const lines = await client.query<{
        id: string; product_id: string; quantity: string | number; unit_cost: string | number;
        disposition: string; product_name: string;
      }>(
        `SELECT l.id,l.product_id,l.quantity,l.unit_cost,l.disposition,p.name AS product_name
         FROM inventory_return_lines l JOIN products p ON p.id=l.product_id AND p.company_id=l.company_id
         WHERE l.company_id=$1 AND l.return_id=$2 ORDER BY l.product_id,l.id FOR UPDATE OF l`,
        [companyId, returnId],
      );
      if (!lines.rows.length) throw new BadRequestException('A return must contain at least one line.');
      for (const line of lines.rows) {
        const quantity = Number(line.quantity);
        const unitCost = Number(line.unit_cost);
        await this.assertProduct(client, companyId, line.product_id);
        if (header.return_type === 'customer' && line.disposition === 'restock') {
          await this.ensureStockRow(client, companyId, header.warehouse_id, line.product_id);
          const locked = await client.query<{ quantity: string | number; average_unit_cost: string | number }>(
            'SELECT quantity,average_unit_cost FROM inventory_stock_levels WHERE company_id=$1 AND warehouse_id=$2 AND product_id=$3 FOR UPDATE',
            [companyId, header.warehouse_id, line.product_id],
          );
          const oldQty = Number(locked.rows[0].quantity);
          const oldCost = Number(locked.rows[0].average_unit_cost);
          const newAverage = oldQty + quantity > 0 ? ((oldQty * oldCost) + (quantity * unitCost)) / (oldQty + quantity) : unitCost;
          await client.query(
            'UPDATE inventory_stock_levels SET quantity=quantity+$1,average_unit_cost=$2,updated_at=NOW() WHERE company_id=$3 AND warehouse_id=$4 AND product_id=$5',
            [quantity, newAverage, companyId, header.warehouse_id, line.product_id],
          );
          const movement = await this.insertMovement(client, {
            companyId, productId: line.product_id, warehouseId: header.warehouse_id,
            type: 'receipt', quantity, unitCost, reference: header.return_number,
            notes: `Customer return restocked: ${line.disposition}`, userId: user.userId,
          });
          await this.postMovementJournal(client, {
            companyId, userId: user.userId, movementId: movement.id, quantity, unitCost,
            description: `Customer return ${header.return_number} - inventory restocked`,
          });
          await this.syncLegacyProductQuantity(client, companyId, line.product_id);
        } else if (header.return_type === 'customer' && line.disposition === 'quarantine') {
          await client.query(
            `INSERT INTO inventory_quarantine_balances(company_id,warehouse_id,product_id,quantity,average_unit_cost)
             VALUES($1,$2,$3,$4,$5)
             ON CONFLICT(company_id,warehouse_id,product_id) DO UPDATE
             SET average_unit_cost=CASE WHEN inventory_quarantine_balances.quantity+$4>0
               THEN ((inventory_quarantine_balances.quantity*inventory_quarantine_balances.average_unit_cost)+($4*$5))/(inventory_quarantine_balances.quantity+$4)
               ELSE $5 END,
               quantity=inventory_quarantine_balances.quantity+$4,updated_at=NOW()`,
            [companyId, header.warehouse_id, line.product_id, quantity, unitCost],
          );
        } else if (header.return_type === 'supplier' && line.disposition === 'return_to_supplier') {
          const stock = await client.query<{ quantity: string | number; reserved_quantity: string | number; average_unit_cost: string | number }>(
            'SELECT quantity,reserved_quantity,average_unit_cost FROM inventory_stock_levels WHERE company_id=$1 AND warehouse_id=$2 AND product_id=$3 FOR UPDATE',
            [companyId, header.warehouse_id, line.product_id],
          );
          if (!stock.rows[0] || Number(stock.rows[0].quantity)-Number(stock.rows[0].reserved_quantity)<quantity) {
            throw new BadRequestException(`Insufficient available stock to return "${line.product_name}" to the supplier.`);
          }
          const cost = Number(stock.rows[0].average_unit_cost);
          await client.query(
            'UPDATE inventory_stock_levels SET quantity=quantity-$1,updated_at=NOW() WHERE company_id=$2 AND warehouse_id=$3 AND product_id=$4',
            [quantity, companyId, header.warehouse_id, line.product_id],
          );
          await this.insertMovement(client, {
            companyId, productId: line.product_id, warehouseId: header.warehouse_id,
            type: 'issue', quantity: -quantity, unitCost: cost, reference: header.return_number,
            notes: 'Supplier return dispatched after inspection', userId: user.userId,
          });
          supplierReturnValue += quantity * cost;
          await this.syncLegacyProductQuantity(client, companyId, line.product_id);
        } else if (line.disposition === 'reject') {
          // Rejected customer goods are recorded for traceability but never enter saleable stock.
        } else {
          throw new BadRequestException('The selected disposition is not valid for this return type.');
        }
      }
      if (header.return_type === 'supplier' && supplierReturnValue > 0) {
        await this.accounting.ensureDefaults(companyId, client);
        const amount = Math.round(supplierReturnValue * 100) / 100;
        const year = new Date().getFullYear();
        const sequence = await client.query<{ next_number: number }>(
          `INSERT INTO journal_entry_sequences(company_id,entry_year,next_number) VALUES($1,$2,1)
           ON CONFLICT(company_id,entry_year) DO UPDATE SET next_number=journal_entry_sequences.next_number+1
           RETURNING next_number`, [companyId, year],
        );
        const entryNumber = `JE-${year}-${String(sequence.rows[0].next_number).padStart(6, '0')}`;
        const journal = await client.query<{ id: string }>(
          `INSERT INTO journal_entries(company_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by)
           VALUES($1,$2,CURRENT_DATE,$3,'supplier_inventory_return',$4,'posted',NOW(),$5) RETURNING id`,
          [companyId, entryNumber, `Supplier return ${header.return_number}`, returnId, user.userId],
        );
        const accounts = await client.query<{ id: string; system_code: string }>(
          `SELECT id,system_code FROM chart_of_accounts
           WHERE company_id=$1 AND system_code IN ('accounts_payable','inventory') AND is_active=true`,
          [companyId],
        );
        const payable = accounts.rows.find(account => account.system_code === 'accounts_payable');
        const inventory = accounts.rows.find(account => account.system_code === 'inventory');
        if (!payable || !inventory) throw new BadRequestException('Accounts payable and inventory control accounts must be active to post a supplier return.');
        await client.query(
          `INSERT INTO journal_entry_lines(company_id,journal_entry_id,account_id,description,debit,credit)
           VALUES($1,$2,$3,'Supplier return debit note',$4,0),($1,$2,$5,'Inventory returned to supplier',0,$4)`,
          [companyId, journal.rows[0].id, payable.id, amount, inventory.id],
        );
      }
      await client.query(
        "UPDATE inventory_returns SET status='posted',posted_by=$1,posted_at=NOW(),updated_at=NOW() WHERE id=$2 AND company_id=$3 AND status='draft'",
        [user.userId, returnId, companyId],
      );
      await this.audit.logInTransaction(client, {
        userId: user.userId, companyId, branchId: header.branch_id,
        action: 'inventory.return.post', entityType: 'inventory_return', entityId: returnId,
        oldValues: { status: 'draft' }, newValues: { status: 'posted', returnNumber: header.return_number },
        ipAddress: null,
      });
    });
    return this.getReturn(user, returnId);
  }

  async listQuarantine(user: AuthenticatedUser) {
    const { companyId, branchId } = await this.resolveMembership(user);
    return (await this.db.query(
      `SELECT q.*,w.name AS warehouse_name,p.name AS product_name,p.sku
       FROM inventory_quarantine_balances q
       JOIN warehouses w ON w.id=q.warehouse_id AND w.company_id=q.company_id
       JOIN products p ON p.id=q.product_id AND p.company_id=q.company_id
       WHERE q.company_id=$1 AND q.quantity>0 AND ($2::uuid IS NULL OR w.branch_id=$2)
       ORDER BY q.updated_at DESC`, [companyId, branchId],
    )).rows;
  }

  async resolveQuarantine(user: AuthenticatedUser, dto: ResolveInventoryQuarantineDto) {
    const { companyId, branchId } = await this.resolveMembership(user);
    await this.db.transaction(async client => {
      await this.assertWarehouse(client, companyId, dto.warehouseId, branchId);
      await this.assertProduct(client, companyId, dto.productId);
      const quarantine = await client.query<{ quantity: string | number; average_unit_cost: string | number }>(
        'SELECT quantity,average_unit_cost FROM inventory_quarantine_balances WHERE company_id=$1 AND warehouse_id=$2 AND product_id=$3 FOR UPDATE',
        [companyId, dto.warehouseId, dto.productId],
      );
      const row = quarantine.rows[0];
      if (!row || Number(row.quantity) + 0.0000001 < dto.quantity) {
        throw new BadRequestException('The requested quantity exceeds the quarantined balance.');
      }
      await client.query(
        'UPDATE inventory_quarantine_balances SET quantity=quantity-$1,updated_at=NOW() WHERE company_id=$2 AND warehouse_id=$3 AND product_id=$4',
        [dto.quantity, companyId, dto.warehouseId, dto.productId],
      );
      if (dto.disposition === 'restock') {
        await this.ensureStockRow(client, companyId, dto.warehouseId, dto.productId);
        const stock = await client.query<{ quantity: string | number; average_unit_cost: string | number }>(
          'SELECT quantity,average_unit_cost FROM inventory_stock_levels WHERE company_id=$1 AND warehouse_id=$2 AND product_id=$3 FOR UPDATE',
          [companyId, dto.warehouseId, dto.productId],
        );
        const oldQuantity = Number(stock.rows[0].quantity);
        const oldCost = Number(stock.rows[0].average_unit_cost);
        const quarantineCost = Number(row.average_unit_cost);
        const average = oldQuantity + dto.quantity > 0
          ? ((oldQuantity * oldCost) + (dto.quantity * quarantineCost)) / (oldQuantity + dto.quantity)
          : quarantineCost;
        await client.query(
          'UPDATE inventory_stock_levels SET quantity=quantity+$1,average_unit_cost=$2,updated_at=NOW() WHERE company_id=$3 AND warehouse_id=$4 AND product_id=$5',
          [dto.quantity, average, companyId, dto.warehouseId, dto.productId],
        );
        const movement = await this.insertMovement(client, {
          companyId, productId: dto.productId, warehouseId: dto.warehouseId, type: 'receipt',
          quantity: dto.quantity, unitCost: quarantineCost, reference: 'QUARANTINE-RELEASE',
          notes: dto.notes?.trim() || 'Inspected quarantined stock released to saleable inventory',
          userId: user.userId,
        });
        await this.postMovementJournal(client, {
          companyId, userId: user.userId, movementId: movement.id, quantity: dto.quantity,
          unitCost: quarantineCost, description: 'Quarantined inventory released to saleable stock',
        });
        await this.syncLegacyProductQuantity(client, companyId, dto.productId);
      }
      await this.audit.logInTransaction(client, {
        userId: user.userId, companyId, branchId, action: dto.disposition === 'restock' ? 'inventory.quarantine.restock' : 'inventory.quarantine.reject',
        entityType: 'inventory_quarantine_balance', entityId: `${dto.warehouseId}:${dto.productId}`,
        oldValues: { quantity: row.quantity }, newValues: { quantity: dto.quantity, disposition: dto.disposition, notes: dto.notes ?? null },
        ipAddress: null,
      });
    });
    return this.listQuarantine(user);
  }

  async cancelReturn(user: AuthenticatedUser, returnId: string) {
    const { companyId, branchId } = await this.resolveMembership(user);
    await this.db.transaction(async client => {
      const result = await client.query<{ id: string; status: string; branch_id: string | null }>(
        'SELECT id,status,branch_id FROM inventory_returns WHERE id=$1 AND company_id=$2 AND ($3::uuid IS NULL OR branch_id=$3) FOR UPDATE',
        [returnId, companyId, branchId],
      );
      const header = result.rows[0];
      if (!header) throw new NotFoundException('Inventory return not found.');
      if (header.status !== 'draft') throw new ConflictException('Only draft returns can be cancelled.');
      await client.query("UPDATE inventory_returns SET status='cancelled',updated_at=NOW() WHERE id=$1 AND company_id=$2",[returnId,companyId]);
      await this.audit.logInTransaction(client, {
        userId: user.userId, companyId, branchId: header.branch_id, action: 'inventory.return.cancel',
        entityType: 'inventory_return', entityId: returnId, oldValues: { status: 'draft' },
        newValues: { status: 'cancelled' }, ipAddress: null,
      });
    });
    return this.getReturn(user, returnId);
  }

  private async postSingleMovement(user: AuthenticatedUser,dto: CreateStockMovementDto,type:'receipt'|'issue',signedQuantity:number) {
    const { companyId, branchId } = await this.resolveMembership(user);
    const movement = await this.db.transaction(async client => {
      await this.assertProduct(client,companyId,dto.productId);
      await this.assertWarehouse(client,companyId,dto.warehouseId,branchId);
      await this.ensureStockRow(client,companyId,dto.warehouseId,dto.productId);
      const stock=await client.query<{quantity:string;reserved_quantity:string;average_unit_cost:string|number}>(
        'SELECT quantity,reserved_quantity,average_unit_cost FROM inventory_stock_levels WHERE company_id=$1 AND warehouse_id=$2 AND product_id=$3 FOR UPDATE',
        [companyId,dto.warehouseId,dto.productId],
      );
      if (type==='issue' && Number(stock.rows[0].quantity)-Number(stock.rows[0].reserved_quantity)<dto.quantity) throw new BadRequestException('Insufficient available stock.');
      const existingAverageCost=Number(stock.rows[0].average_unit_cost ?? 0);
      const movementCost=type==='receipt' ? Number(dto.unitCost ?? existingAverageCost) : existingAverageCost;
      if(type==='receipt' && dto.unitCost===undefined && movementCost<=0){
        throw new BadRequestException('A unit cost is required when receiving stock without an existing positive average cost.');
      }
      if(type==='receipt'){
        await client.query(
          `UPDATE inventory_stock_levels
           SET average_unit_cost=CASE WHEN quantity+$1>0 THEN ((quantity*average_unit_cost)+($1*$2))/(quantity+$1) ELSE $2 END,
               quantity=quantity+$1,updated_at=NOW()
           WHERE company_id=$3 AND warehouse_id=$4 AND product_id=$5`,
          [dto.quantity,movementCost,companyId,dto.warehouseId,dto.productId],
        );
      } else {
        await client.query(
          'UPDATE inventory_stock_levels SET quantity=quantity+$1,updated_at=NOW() WHERE company_id=$2 AND warehouse_id=$3 AND product_id=$4',
          [signedQuantity,companyId,dto.warehouseId,dto.productId],
        );
      }
      const saved=await this.insertMovement(client,{companyId,productId:dto.productId,warehouseId:dto.warehouseId,type,quantity:signedQuantity,unitCost:movementCost,reference:dto.reference,notes:dto.notes,userId:user.userId});
      await this.postMovementJournal(client,{companyId,userId:user.userId,movementId:saved.id,quantity:signedQuantity,unitCost:movementCost,description:`Manual stock ${type} ${dto.reference?.trim() || saved.id}`});
      await this.syncLegacyProductQuantity(client,companyId,dto.productId);
      await this.logMovement(client,user,companyId,branchId,saved.id,type==='receipt'?'inventory.stock.receipt':'inventory.stock.issue',{productId:dto.productId,warehouseId:dto.warehouseId,quantity:dto.quantity});
      return saved;
    });
    return movement;
  }

  private async postMovementJournal(client:PoolClient,input:{companyId:string;userId:string;movementId:string;quantity:number;unitCost:number;description:string}) {
    const amount=Math.round(Math.abs(input.quantity*input.unitCost)*100)/100;
    // A zero-cost movement changes quantities but has no monetary journal value.
    if(amount<=0)return;
    await this.accounting.ensureDefaults(input.companyId,client);
    const accounts=await client.query<{id:string;system_code:string}>(
      "SELECT id,system_code FROM chart_of_accounts WHERE company_id=$1 AND system_code IN ('inventory','purchases_expense') AND is_active=true",
      [input.companyId],
    );
    const inventory=accounts.rows.find(account=>account.system_code==='inventory');
    const adjustment=accounts.rows.find(account=>account.system_code==='purchases_expense');
    if(!inventory||!adjustment)throw new BadRequestException('Inventory and purchases/adjustment accounts must be active.');
    const year=new Date().getFullYear();
    const sequence=await client.query<{next_number:number}>(
      `INSERT INTO journal_entry_sequences(company_id,entry_year,next_number) VALUES($1,$2,1)
       ON CONFLICT(company_id,entry_year) DO UPDATE SET next_number=journal_entry_sequences.next_number+1
       RETURNING next_number`,
      [input.companyId,year],
    );
    const entryNumber=`JE-${year}-${String(sequence.rows[0].next_number).padStart(6,'0')}`;
    const entry=await client.query<{id:string}>(
      `INSERT INTO journal_entries(company_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by)
       VALUES($1,$2,CURRENT_DATE,$3,'inventory_manual_movement',$4,'posted',NOW(),$5) RETURNING id`,
      [input.companyId,entryNumber,input.description.slice(0,500),input.movementId,input.userId],
    );
    if(input.quantity>0){
      await client.query(
        `INSERT INTO journal_entry_lines(company_id,journal_entry_id,account_id,description,debit,credit)
         VALUES($1,$2,$3,'Inventory increase', $4,0),($1,$2,$5,'Inventory adjustment offset',0,$4)`,
        [input.companyId,entry.rows[0].id,inventory.id,amount,adjustment.id],
      );
    }else{
      await client.query(
        `INSERT INTO journal_entry_lines(company_id,journal_entry_id,account_id,description,debit,credit)
         VALUES($1,$2,$3,'Inventory adjustment expense',$4,0),($1,$2,$5,'Inventory decrease',0,$4)`,
        [input.companyId,entry.rows[0].id,adjustment.id,amount,inventory.id],
      );
    }
  }

  private async insertMovement(client:PoolClient,input:{companyId:string;productId:string;warehouseId:string;type:string;quantity:number;unitCost:number;reference?:string;notes?:string;userId:string;transferGroupId?:string}) {
    const result=await client.query<MovementRow>(
      `INSERT INTO inventory_stock_movements(company_id,product_id,warehouse_id,movement_type,quantity,unit_cost,reference,notes,created_by,transfer_group_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [input.companyId,input.productId,input.warehouseId,input.type,input.quantity,input.unitCost,input.reference ?? null,input.notes ?? null,input.userId,input.transferGroupId ?? null],
    );
    return result.rows[0];
  }

  private async ensureStockRow(client:PoolClient,companyId:string,warehouseId:string,productId:string) {
    await client.query(
      `INSERT INTO inventory_stock_levels(company_id,warehouse_id,product_id,reorder_level)
       SELECT $1,$2,p.id,p.reorder_level FROM products p WHERE p.id=$3 AND p.company_id=$1 AND p.is_service=false
       ON CONFLICT(warehouse_id,product_id) DO NOTHING`,
      [companyId,warehouseId,productId],
    );
  }

  private async assertProduct(client:PoolClient,companyId:string,productId:string) {
    const result=await client.query<{id:string;is_service:boolean}>('SELECT id,is_service FROM products WHERE id=$1 AND company_id=$2 AND is_active=true FOR SHARE',[productId,companyId]);
    if(!result.rows[0]) throw new NotFoundException('Active product not found in this company.');
    if(result.rows[0].is_service) throw new BadRequestException('Service items do not have stock.');
  }

  private async assertWarehouse(client:PoolClient,companyId:string,warehouseId:string,branchId:string|null) {
    const result=await client.query<{id:string;branch_id:string|null}>('SELECT id,branch_id FROM warehouses WHERE id=$1 AND company_id=$2 AND is_active=true AND ($3::uuid IS NULL OR branch_id=$3) FOR SHARE',[warehouseId,companyId,branchId]);
    if(!result.rows[0]) throw new NotFoundException('Active warehouse not found in your company and assigned branch.');
  }

  private async assertBranch(companyId:string,branchId:string) {
    const result=await this.db.query<{id:string}>('SELECT id FROM branches WHERE id=$1 AND company_id=$2 AND is_active=true',[branchId,companyId]);
    if(!result.rows[0]) throw new NotFoundException('Active branch not found in this company.');
  }

  private async syncLegacyProductQuantity(client:PoolClient,companyId:string,productId:string) {
    await client.query(
      `UPDATE products SET stock_quantity=COALESCE((SELECT SUM(quantity) FROM inventory_stock_levels WHERE company_id=$1 AND product_id=$2),0),updated_at=NOW()
       WHERE company_id=$1 AND id=$2`,[companyId,productId],
    );
  }

  private async logMovement(client:PoolClient,user:AuthenticatedUser,companyId:string,branchId:string|null,entityId:string,action:string,values:Record<string,unknown>) {
    await this.audit.logInTransaction(client,{userId:user.userId,companyId,branchId,action,entityType:'inventory_movement',entityId,oldValues:null,newValues:values,ipAddress:null});
  }
}
