import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { InventoryService } from './inventory.service.js';

type Mock = ReturnType<typeof vi.fn>;

describe('InventoryService', () => {
  let service: InventoryService;
  let db: { query: Mock; transaction: Mock };
  let memberships: { getMembership: Mock };
  let audit: { log: Mock; logInTransaction: Mock };
  let accounting: { ensureDefaults: Mock };

  beforeEach(async () => {
    db = { query: vi.fn(), transaction: vi.fn() };
    memberships = { getMembership: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null, role: 'owner' }) };
    audit = { log: vi.fn().mockResolvedValue(undefined), logInTransaction: vi.fn().mockResolvedValue(undefined) };
    accounting = { ensureDefaults: vi.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: DatabaseService, useValue: db },
        { provide: MembershipsService, useValue: memberships },
        { provide: AuditService, useValue: audit },
        { provide: AccountingService, useValue: accounting },
      ],
    }).compile();

    service = module.get(InventoryService);
  });

  const user = { userId: 'user-1' } as any;

  it('keeps warehouse listing read-only and does not create a default warehouse', async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await service.listWarehouses(user);

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toContain('FROM warehouses w');
    expect(db.query.mock.calls[0][0]).not.toContain('INSERT INTO');
  });

  it('keeps stock listing read-only and does not create stock rows or opening movements', async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await service.listStock(user);

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toContain('FROM inventory_stock_levels s');
    expect(db.query.mock.calls[0][0]).not.toContain('INSERT INTO');
  });

  it('keeps movement history read-only', async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await service.listMovements(user);

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toContain('FROM inventory_stock_movements m');
    expect(db.query.mock.calls[0][0]).not.toContain('INSERT INTO');
  });

  it('keeps inventory summary read-only', async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await service.summary(user);

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toContain('FROM inventory_stock_levels s');
    expect(db.query.mock.calls[0][0]).not.toContain('INSERT INTO');
  });

  it('limits warehouse, stock, and movement reads to the assigned branch', async () => {
    const branchId = '11111111-1111-4111-8111-111111111111';
    memberships.getMembership.mockResolvedValue({ companyId: 'company-1', branchId, role: 'manager' });
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await service.listWarehouses(user);
    await service.listStock(user);
    await service.listMovements(user);

    expect(db.query.mock.calls[0][0]).toContain('w.branch_id=$2');
    expect(db.query.mock.calls[0][1]).toEqual(['company-1', branchId]);
    expect(db.query.mock.calls[1][0]).toContain('w.branch_id=$2');
    expect(db.query.mock.calls[1][1]).toEqual(['company-1', branchId]);
    expect(db.query.mock.calls[2][0]).toContain('w.branch_id=$2');
    expect(db.query.mock.calls[2][1]).toEqual(['company-1', branchId, 100]);
  });

  it('rejects company-wide inventory reconciliation for a branch-restricted member', async () => {
    memberships.getMembership.mockResolvedValue({
      companyId: 'company-1',
      branchId: '11111111-1111-4111-8111-111111111111',
      role: 'manager',
    });

    await expect(service.reconciliation(user)).rejects.toThrow(ForbiddenException);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('denies direct warehouse-ID reads for a warehouse outside the assigned branch', async () => {
    const branchId = '11111111-1111-4111-8111-111111111111';
    memberships.getMembership.mockResolvedValue({ companyId: 'company-1', branchId, role: 'manager' });
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(service.getWarehouse(user, 'warehouse-other-branch')).rejects.toThrow(NotFoundException);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE w.id=$1 AND w.company_id=$2 AND ($3::uuid IS NULL OR w.branch_id=$3)'),
      ['warehouse-other-branch', 'company-1', branchId],
    );
  });

  it('rejects creating a warehouse outside the assigned branch before database writes', async () => {
    memberships.getMembership.mockResolvedValue({
      companyId: 'company-1',
      branchId: '11111111-1111-4111-8111-111111111111',
      role: 'manager',
    });

    await expect(service.createWarehouse(user, {
      code: 'OTHER',
      name: 'Other branch',
      branchId: '22222222-2222-4222-8222-222222222222',
    })).rejects.toThrow(ForbiddenException);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('defaults branch-scoped warehouse creation to the member branch when the UI omits branchId', async () => {
    const branchId = '11111111-1111-4111-8111-111111111111';
    memberships.getMembership.mockResolvedValue({ companyId: 'company-1', branchId, role: 'manager' });
    db.query
      .mockResolvedValueOnce({ rows: [{ id: branchId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{
        id: 'warehouse-new', company_id: 'company-1', branch_id: branchId,
        code: 'MAIN', name: 'Main', location: null, capacity: 0, is_active: true,
        created_at: '2026-10-23T00:00:00.000Z', updated_at: '2026-10-23T00:00:00.000Z',
      }], rowCount: 1 });

    const result = await service.createWarehouse(user, { code: 'main', name: 'Main' });

    expect(result.branch_id).toBe(branchId);
    expect(db.query).toHaveBeenNthCalledWith(3,
      expect.stringContaining('INSERT INTO warehouses'),
      ['company-1', branchId, 'MAIN', 'Main', null, 0, true],
    );
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ branchId, action: 'inventory.warehouse.create' }));
  });

  it('keeps the assigned-branch predicate on the warehouse update statement itself', async () => {
    const branchId = '11111111-1111-4111-8111-111111111111';
    memberships.getMembership.mockResolvedValue({ companyId: 'company-1', branchId, role: 'manager' });
    const existing = {
      id: 'warehouse-1', company_id: 'company-1', branch_id: branchId,
      code: 'MAIN', name: 'Main', location: null, capacity: 0, is_active: true,
      created_at: '2026-10-23T00:00:00.000Z', updated_at: '2026-10-23T00:00:00.000Z',
    };
    db.query
      .mockResolvedValueOnce({ rows: [existing], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ ...existing, name: 'Renamed' }], rowCount: 1 });

    await service.updateWarehouse(user, 'warehouse-1', { name: 'Renamed' });

    expect(db.query.mock.calls[1][0]).toContain('WHERE id=$2 AND company_id=$3 AND ($4::uuid IS NULL OR branch_id=$4)');
    expect(db.query.mock.calls[1][1]).toEqual(['Renamed', 'warehouse-1', 'company-1', branchId]);
  });

  it('reconciles stock levels against movement history, legacy totals, and the inventory control account without writes', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ mismatch_count: 1, absolute_quantity_variance: '2.000' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ mismatch_count: 0, absolute_quantity_variance: '0.000' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ stock_cost_value: '120.00', inventory_account_balance: '100.00' }], rowCount: 1 });

    const result = await service.reconciliation(user);

    expect(result.stockLedger).toEqual({ mismatchCount: 1, absoluteQuantityVariance: 2, reconciled: false });
    expect(result.legacyProductQuantities).toEqual({ mismatchCount: 0, absoluteQuantityVariance: 0, reconciled: true });
    expect(result.valuation).toEqual({ basis: 'weighted_average_cost', stockCostValue: 120, inventoryAccountBalance: 100, variance: 20, reconciled: false });
    expect(db.query).toHaveBeenCalledTimes(3);
    expect(db.query.mock.calls[0][0]).toContain('FULL OUTER JOIN movement_totals');
    expect(db.query.mock.calls[1][0]).toContain('products p');
    expect(db.query.mock.calls[2][0]).toContain("a.system_code='inventory'");
    for (const [sql] of db.query.mock.calls) expect(sql).not.toContain('INSERT INTO');
  });

  it('reports a clean reconciliation when all inventory quantities and values agree', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ mismatch_count: 0, absolute_quantity_variance: '0.000' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ mismatch_count: 0, absolute_quantity_variance: '0.000' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ stock_cost_value: '100.00', inventory_account_balance: '100.00' }], rowCount: 1 });

    const result = await service.reconciliation(user);

    expect(result.stockLedger.reconciled).toBe(true);
    expect(result.legacyProductQuantities.reconciled).toBe(true);
    expect(result.valuation.reconciled).toBe(true);
    expect(db.query.mock.calls.every(([sql]) => !String(sql).includes('INSERT INTO'))).toBe(true);
  });

  it('rejects a blank warehouse code before writing to the database', async () => {
    await expect(service.createWarehouse(user, { code: '   ', name: 'Main' })).rejects.toThrow(BadRequestException);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects a blank warehouse name before writing to the database', async () => {
    await expect(service.createWarehouse(user, { code: 'MAIN', name: '   ' })).rejects.toThrow(BadRequestException);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('normalizes warehouse codes and checks duplicates within the active company', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'warehouse-1' }], rowCount: 1 });

    await expect(service.createWarehouse(user, { code: ' main ', name: 'Main' })).rejects.toThrow(ConflictException);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE company_id=$1 AND UPPER(code)=UPPER($2)'),
      ['company-1', 'MAIN'],
    );
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('returns not found when a warehouse belongs to a different company', async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(service.getWarehouse(user, 'warehouse-other-company')).rejects.toThrow(NotFoundException);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE w.id=$1 AND w.company_id=$2'),
      ['warehouse-other-company', 'company-1', null],
    );
  });

  it('rejects a receipt into a warehouse outside the assigned branch before stock writes', async () => {
    const branchId = '11111111-1111-4111-8111-111111111111';
    memberships.getMembership.mockResolvedValue({ companyId: 'company-1', branchId, role: 'manager' });
    const client = { query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id,is_service FROM products')) return { rows: [{ id: 'product-1', is_service: false }], rowCount: 1 };
      if (sql.includes('FROM warehouses WHERE id=$1')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    }) };
    db.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) => callback(client));

    await expect(service.receive(user, {
      productId: 'product-1',
      warehouseId: 'warehouse-other-branch',
      quantity: 2,
      unitCost: 10,
    })).rejects.toThrow(NotFoundException);

    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some(sql => sql.includes('UPDATE inventory_stock_levels'))).toBe(false);
    expect(statements.some(sql => sql.includes('INSERT INTO inventory_stock_movements'))).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects a transfer to a warehouse outside the assigned branch before ledger writes', async () => {
    const branchId = '11111111-1111-4111-8111-111111111111';
    memberships.getMembership.mockResolvedValue({ companyId: 'company-1', branchId, role: 'manager' });
    const client = { query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT id,is_service FROM products')) return { rows: [{ id: 'product-1', is_service: false }], rowCount: 1 };
      if (sql.includes('FROM warehouses WHERE id=$1')) {
        return params?.[0] === 'warehouse-source'
          ? { rows: [{ id: 'warehouse-source', branch_id: branchId }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    }) };
    db.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) => callback(client));

    await expect(service.transfer(user, {
      productId: 'product-1',
      sourceWarehouseId: 'warehouse-source',
      destinationWarehouseId: 'warehouse-other-branch',
      quantity: 1,
    })).rejects.toThrow(NotFoundException);

    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some(sql => sql.includes('UPDATE inventory_stock_levels'))).toBe(false);
    expect(statements.some(sql => sql.includes('INSERT INTO inventory_stock_movements'))).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('posts transfers as paired ledger movements and scopes all stock writes to the membership company', async () => {
    const client = { query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT id,is_service FROM products')) return { rows: [{ id: 'product-1', is_service: false }], rowCount: 1 };
      if (sql.includes('FROM warehouses WHERE id=$1')) return { rows: [{ id: params?.[0] }], rowCount: 1 };
      if (sql.includes('SELECT quantity,reserved_quantity,average_unit_cost FROM inventory_stock_levels')) return { rows: [{ quantity: '10', reserved_quantity: '2' }], rowCount: 1 };
      if (sql.includes('INSERT INTO inventory_stock_movements')) {
        return { rows: [{ id: params?.[3] === 'transfer_out' ? 'movement-out' : 'movement-in', movement_type: params?.[3], quantity: params?.[4], transfer_group_id: params?.[9] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }) };
    db.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) => callback(client));

    const result = await service.transfer(user, {
      productId: 'product-1',
      sourceWarehouseId: 'warehouse-a',
      destinationWarehouseId: 'warehouse-b',
      quantity: 3,
      unitCost: 12,
    });

    expect(result.sourceMovement.id).toBe('movement-out');
    expect(result.destinationMovement.id).toBe('movement-in');
    expect(result.sourceMovement.quantity).toBe(-3);
    expect(result.destinationMovement.quantity).toBe(3);
    expect(result.sourceMovement.transfer_group_id).toBe(result.transferGroupId);
    expect(result.destinationMovement.transfer_group_id).toBe(result.transferGroupId);

    const calls = client.query.mock.calls as unknown as [string, unknown[]?][];
    const locks = calls.filter(([sql]) => sql.includes('FOR UPDATE'));
    expect(locks).toHaveLength(2);
    expect(locks[0][1]?.[1]).toBe('warehouse-a');
    expect(locks[1][1]?.[1]).toBe('warehouse-b');
    expect(calls.filter(([sql]) => sql.includes('UPDATE inventory_stock_levels SET quantity=quantity-'))).toHaveLength(1);
    expect(calls.filter(([sql]) => sql.includes('UPDATE inventory_stock_levels') && sql.includes('quantity=quantity+$1'))).toHaveLength(1);
    expect(calls.filter(([sql]) => sql.includes('INSERT INTO inventory_stock_movements'))).toHaveLength(2);
    expect(calls.some(([sql, params]) => sql.includes('UPDATE products SET stock_quantity') && params?.[0] === 'company-1')).toBe(true);
    expect(audit.logInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      companyId: 'company-1',
      action: 'inventory.stock.transfer',
      entityId: result.transferGroupId,
    }));
  });

  it('rejects a transfer that would consume reserved stock without writing movements', async () => {
    const client = { query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id,is_service FROM products')) return { rows: [{ id: 'product-1', is_service: false }], rowCount: 1 };
      if (sql.includes('FROM warehouses WHERE id=$1')) return { rows: [{ id: 'warehouse' }], rowCount: 1 };
      if (sql.includes('SELECT quantity,reserved_quantity,average_unit_cost FROM inventory_stock_levels')) return { rows: [{ quantity: '5', reserved_quantity: '4' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }) };
    db.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) => callback(client));

    await expect(service.transfer(user, {
      productId: 'product-1',
      sourceWarehouseId: 'warehouse-a',
      destinationWarehouseId: 'warehouse-b',
      quantity: 2,
    })).rejects.toThrow(BadRequestException);

    const calls = client.query.mock.calls as unknown as [string, unknown[]?][];
    expect(calls.some(([sql]) => sql.includes('UPDATE inventory_stock_levels'))).toBe(false);
    expect(calls.some(([sql]) => sql.includes('INSERT INTO inventory_stock_movements'))).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects a transfer between the same warehouse before opening a transaction', async () => {
    await expect(service.transfer(user, {
      productId: 'product-1',
      sourceWarehouseId: 'warehouse-a',
      destinationWarehouseId: 'warehouse-a',
      quantity: 1,
    })).rejects.toThrow(BadRequestException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('records receipts as a stock-ledger movement and preserves branch context in the audit event', async () => {
    const branchId = '11111111-1111-4111-8111-111111111111';
    memberships.getMembership.mockResolvedValue({ companyId: 'company-1', branchId, role: 'manager' });
    const client = { query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT id,is_service FROM products')) return { rows: [{ id: 'product-1', is_service: false }], rowCount: 1 };
      if (sql.includes('FROM warehouses WHERE id=$1')) return { rows: [{ id: 'warehouse-1' }], rowCount: 1 };
      if (sql.includes('SELECT quantity,reserved_quantity,average_unit_cost FROM inventory_stock_levels')) return { rows: [{ quantity: '3', reserved_quantity: '1', average_unit_cost: '10' }], rowCount: 1 };
      if (sql.includes('INSERT INTO inventory_stock_movements')) return { rows: [{ id: 'receipt-movement', movement_type: params?.[3], quantity: params?.[4] }], rowCount: 1 };
      if (sql.includes("system_code IN ('inventory','purchases_expense')")) return { rows: [{id:'account-inventory',system_code:'inventory'},{id:'account-adjustment',system_code:'purchases_expense'}], rowCount: 2 };
      if (sql.includes('INSERT INTO journal_entry_sequences')) return { rows: [{next_number:1}], rowCount:1 };
      if (sql.includes('INSERT INTO journal_entries')) return { rows: [{id:'journal-receipt'}], rowCount:1 };
      return { rows: [], rowCount: 1 };
    }) };
    db.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) => callback(client));

    const result = await service.receive(user, {
      productId: 'product-1', warehouseId: 'warehouse-1', quantity: 4, unitCost: 15,
    });

    expect(result.id).toBe('receipt-movement');
    const calls = client.query.mock.calls as unknown as [string, unknown[]?][];
    expect(calls.some(([sql, params]) => sql.includes('UPDATE inventory_stock_levels') && sql.includes('average_unit_cost=CASE') && params?.[0] === 4 && params?.[1] === 15)).toBe(true);
    expect(calls.some(([sql, params]) => sql.includes('INSERT INTO inventory_stock_movements') && params?.[3] === 'receipt' && params?.[4] === 4 && params?.[5] === 15)).toBe(true);
    expect(calls.some(([sql, params]) => sql.includes('UPDATE products SET stock_quantity') && params?.[0] === 'company-1')).toBe(true);
    expect(audit.logInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'inventory.stock.receipt',
      entityId: 'receipt-movement',
      companyId: 'company-1',
      branchId,
    }));
  });

  it('rejects an unpriced receipt when no positive average cost exists', async () => {
    const client = { query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id,is_service FROM products')) return { rows: [{ id: 'product-1', is_service: false }], rowCount: 1 };
      if (sql.includes('FROM warehouses WHERE id=$1')) return { rows: [{ id: 'warehouse-1' }], rowCount: 1 };
      if (sql.includes('SELECT quantity,reserved_quantity,average_unit_cost FROM inventory_stock_levels')) return { rows: [{ quantity: '0', reserved_quantity: '0', average_unit_cost: '0' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }) };
    db.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) => callback(client));

    await expect(service.receive(user, {
      productId: 'product-1', warehouseId: 'warehouse-1', quantity: 2,
    })).rejects.toThrow('A unit cost is required');

    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some(sql => sql.includes('UPDATE inventory_stock_levels'))).toBe(false);
    expect(statements.some(sql => sql.includes('INSERT INTO inventory_stock_movements'))).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects an unpriced positive adjustment when no positive average cost exists', async () => {
    const client = { query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id,is_service FROM products')) return { rows: [{ id: 'product-1', is_service: false }], rowCount: 1 };
      if (sql.includes('FROM warehouses WHERE id=$1')) return { rows: [{ id: 'warehouse-1' }], rowCount: 1 };
      if (sql.includes('SELECT quantity,reserved_quantity,average_unit_cost FROM inventory_stock_levels')) return { rows: [{ quantity: '0', reserved_quantity: '0', average_unit_cost: '0' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }) };
    db.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) => callback(client));

    await expect(service.adjust(user, {
      productId: 'product-1', warehouseId: 'warehouse-1', newQuantity: 2,
    })).rejects.toThrow('A unit cost is required');

    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some(sql => sql.includes('UPDATE inventory_stock_levels'))).toBe(false);
    expect(statements.some(sql => sql.includes('INSERT INTO inventory_stock_movements'))).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('uses existing weighted-average cost for stock issues', async () => {
    const client = { query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT id,is_service FROM products')) return { rows: [{ id: 'product-1', is_service: false }], rowCount: 1 };
      if (sql.includes('FROM warehouses WHERE id=$1')) return { rows: [{ id: 'warehouse-1' }], rowCount: 1 };
      if (sql.includes('SELECT quantity,reserved_quantity,average_unit_cost FROM inventory_stock_levels')) return { rows: [{ quantity: '10', reserved_quantity: '1', average_unit_cost: '7.25' }], rowCount: 1 };
      if (sql.includes('INSERT INTO inventory_stock_movements')) return { rows: [{ id: 'issue-movement', movement_type: params?.[3], quantity: params?.[4], unit_cost: params?.[5] }], rowCount: 1 };
      if (sql.includes("system_code IN ('inventory','purchases_expense')")) return { rows: [{id:'account-inventory',system_code:'inventory'},{id:'account-adjustment',system_code:'purchases_expense'}], rowCount: 2 };
      if (sql.includes('INSERT INTO journal_entry_sequences')) return { rows: [{next_number:1}], rowCount:1 };
      if (sql.includes('INSERT INTO journal_entries')) return { rows: [{id:'journal-issue'}], rowCount:1 };
      return { rows: [], rowCount: 1 };
    }) };
    db.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) => callback(client));

    await service.issue(user, { productId: 'product-1', warehouseId: 'warehouse-1', quantity: 2 });

    const calls = client.query.mock.calls as unknown as [string, unknown[]?][];
    expect(calls.some(([sql, params]) => sql.includes('INSERT INTO inventory_stock_movements') && params?.[3] === 'issue' && params?.[4] === -2 && params?.[5] === 7.25)).toBe(true);
  });

  it('rejects issuing stock that is reserved and leaves stock and ledger untouched', async () => {
    const client = { query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id,is_service FROM products')) return { rows: [{ id: 'product-1', is_service: false }], rowCount: 1 };
      if (sql.includes('FROM warehouses WHERE id=$1')) return { rows: [{ id: 'warehouse-1' }], rowCount: 1 };
      if (sql.includes('SELECT quantity,reserved_quantity,average_unit_cost FROM inventory_stock_levels')) return { rows: [{ quantity: '5', reserved_quantity: '4' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }) };
    db.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) => callback(client));

    await expect(service.issue(user, {
      productId: 'product-1', warehouseId: 'warehouse-1', quantity: 2,
    })).rejects.toThrow(BadRequestException);

    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some(sql => sql.includes('UPDATE inventory_stock_levels SET quantity=quantity+$1'))).toBe(false);
    expect(statements.some(sql => sql.includes('INSERT INTO inventory_stock_movements'))).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects stock adjustments below reserved quantity without changing stock', async () => {
    const client = { query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id,is_service FROM products')) return { rows: [{ id: 'product-1', is_service: false }], rowCount: 1 };
      if (sql.includes('FROM warehouses WHERE id=$1')) return { rows: [{ id: 'warehouse-1' }], rowCount: 1 };
      if (sql.includes('SELECT quantity,reserved_quantity,average_unit_cost FROM inventory_stock_levels')) return { rows: [{ quantity: '8', reserved_quantity: '3' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }) };
    db.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) => callback(client));

    await expect(service.adjust(user, {
      productId: 'product-1', warehouseId: 'warehouse-1', newQuantity: 2,
    })).rejects.toThrow(BadRequestException);

    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some(sql => sql.includes('UPDATE inventory_stock_levels SET quantity=$1'))).toBe(false);
    expect(statements.some(sql => sql.includes('INSERT INTO inventory_stock_movements'))).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
  });

});
