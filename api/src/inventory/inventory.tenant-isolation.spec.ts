import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { InventoryService } from './inventory.service.js';

type Mock = ReturnType<typeof vi.fn>;

describe('InventoryService tenant isolation', () => {
  let service: InventoryService;
  let db: { query: Mock; transaction: Mock };
  let memberships: { getMembership: Mock };
  let audit: { log: Mock };

  const user = { userId: 'user-company-2', companyId: 'company-2' } as any;

  beforeEach(async () => {
    db = { query: vi.fn(), transaction: vi.fn() };
    memberships = {
      getMembership: vi.fn().mockResolvedValue({
        companyId: 'company-1',
        branchId: null,
        role: 'owner',
      }),
      getMembershipForCompany: vi.fn().mockResolvedValue({
        companyId: 'company-2',
        branchId: null,
        role: 'owner',
      }),
    };
    audit = { log: vi.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: DatabaseService, useValue: db },
        { provide: MembershipsService, useValue: memberships },
        { provide: AuditService, useValue: audit },
        { provide: AccountingService, useValue: { ensureDefaults: vi.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get(InventoryService);
  });

  it('uses the explicitly selected company membership rather than another membership', async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await service.listWarehouses(user);

    expect(memberships.getMembershipForCompany).toHaveBeenCalledWith('user-company-2', 'company-2');
    expect(memberships.getMembership).not.toHaveBeenCalled();
    expect(db.query.mock.calls[0][1]).toEqual(['company-2', null]);
  });

  it('scopes warehouse, stock, movement, and summary reads to the resolved company', async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await service.listWarehouses(user);
    await service.listStock(user);
    await service.listMovements(user);
    await service.summary(user);

    expect(db.query).toHaveBeenCalledTimes(4);
    for (const [, params] of db.query.mock.calls as [string, unknown[]][]) {
      expect(params).toContain('company-2');
    }
    expect(db.query.mock.calls[0][0]).toContain('WHERE w.company_id=$1');
    expect(db.query.mock.calls[1][0]).toContain('s.company_id=$1');
    expect(db.query.mock.calls[2][0]).toContain('WHERE m.company_id=$1');
    expect(db.query.mock.calls[3][0]).toContain('WHERE s.company_id=$1');
  });

  it('does not reveal a warehouse when its id belongs to another company', async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await expect(service.getWarehouse(user, 'warehouse-from-company-1')).rejects.toThrow(NotFoundException);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE w.id=$1 AND w.company_id=$2'),
      ['warehouse-from-company-1', 'company-2', null],
    );
  });

  it('rejects a product outside the member company before any stock write', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT id,is_service FROM products')) {
          expect(params).toEqual(['product-from-company-1', 'company-2']);
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    db.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) => callback(client));

    await expect(service.receive(user, {
      productId: 'product-from-company-1',
      warehouseId: 'warehouse-company-2',
      quantity: 2,
    } as any)).rejects.toThrow(NotFoundException);

    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes('UPDATE inventory_stock_levels'))).toBe(false);
    expect(statements.some((sql) => sql.includes('INSERT INTO inventory_stock_movements'))).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects a destination warehouse outside the member company before transfer writes', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT id,is_service FROM products')) {
          return { rows: [{ id: 'product-company-2', is_service: false }], rowCount: 1 };
        }
        if (sql.includes('FROM warehouses WHERE id=$1')) {
          return params?.[0] === 'warehouse-company-2'
            ? { rows: [{ id: 'warehouse-company-2' }], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    db.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) => callback(client));

    await expect(service.transfer(user, {
      productId: 'product-company-2',
      sourceWarehouseId: 'warehouse-company-2',
      destinationWarehouseId: 'warehouse-from-company-1',
      quantity: 1,
    } as any)).rejects.toThrow(NotFoundException);

    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes('UPDATE inventory_stock_levels'))).toBe(false);
    expect(statements.some((sql) => sql.includes('INSERT INTO inventory_stock_movements'))).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
  });
});
