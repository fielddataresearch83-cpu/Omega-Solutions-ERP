import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { ProductsService } from './products.service.js';
import { ProductImageStorageService } from './product-image-storage.service.js';

type Mock = ReturnType<typeof vi.fn>;

describe('ProductsService initial stock', () => {
  let service: ProductsService;
  let db: { query: Mock; transaction: Mock };
  let memberships: { getMembership: Mock; getMembershipForCompany: Mock };
  let audit: { log: Mock };
  let accounting: { ensureDefaults: Mock };
  let imageStorage: { signedReadUrl: Mock; newKey: Mock; upload: Mock; remove: Mock };
  let client: { query: Mock };

  const user = { userId: 'user-1' } as any;
  const dto = {
    sku: 'TEST-001',
    name: 'Test product',
    sellingPrice: 150,
    costPrice: 80,
    stockQuantity: 5,
    reorderLevel: 2,
  };

  beforeEach(async () => {
    client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql.includes('SELECT id FROM products WHERE company_id')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('INSERT INTO products')) {
          return {
            rows: [{
              id: 'product-1',
              company_id: 'company-1',
              sku: dto.sku,
              name: dto.name,
              stock_quantity: params?.[9] ?? 0,
              is_service: params?.[13] ?? false,
              tax_treatment: params?.[11] ?? 'legacy',
              tax_rate: params?.[12] ?? 0,
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT id FROM warehouses')) {
          return { rows: [{ id: 'warehouse-1' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO journal_entry_sequences')) return { rows: [{ next_number: 1 }], rowCount: 1 };
        if (sql.includes('INSERT INTO journal_entries')) return { rows: [{ id: 'journal-1' }], rowCount: 1 };
        if (sql.includes('SELECT id,system_code FROM chart_of_accounts')) return { rows: [{ id: 'account-inventory', system_code: 'inventory' }, { id: 'account-equity', system_code: 'equity' }], rowCount: 2 };
        if (sql.includes('INSERT INTO inventory_stock_movements')) {
          return { rows: [{ id: 'movement-1' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    db = {
      query: vi.fn().mockResolvedValue({ rows: [{ settings: null }], rowCount: 1 }),
      transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(client)),
    };
    memberships = {
      getMembership: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null, role: 'owner' }),
      getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-2', branchId: null, role: 'owner' }),
    };
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    accounting = { ensureDefaults: vi.fn().mockResolvedValue(undefined) };
    imageStorage = {
      signedReadUrl: vi.fn((key: string) => 'signed:' + key),
      newKey: vi.fn(() => 'companies/company-1/products/product-1/new.jpg'),
      upload: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: DatabaseService, useValue: db },
        { provide: MembershipsService, useValue: memberships },
        { provide: AuditService, useValue: audit },
        { provide: AccountingService, useValue: accounting },
        { provide: ProductImageStorageService, useValue: imageStorage },
      ],
    }).compile();
    service = module.get(ProductsService);
  });

  it('uses the company selected in the authenticated user context instead of the default membership', async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await service.list({ ...user, companyId: 'company-2' } as any);

    expect(memberships.getMembershipForCompany).toHaveBeenCalledWith('user-1', 'company-2');
    expect(memberships.getMembership).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE company_id = $1 ORDER BY created_at DESC'), ['company-2']);
  });

  it('records positive initial stock in the stock ledger and opening-balance movement in one transaction', async () => {
    await service.create(user, dto as any);

    expect(accounting.ensureDefaults).toHaveBeenCalledWith('company-1');
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('tax_treatment, tax_rate'),
      expect.arrayContaining(['legacy', 0]),
    );
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO inventory_stock_levels'),
      ['company-1', 'warehouse-1', 'product-1', 5, 2],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("'opening_balance'"),
      ['company-1', 'product-1', 'warehouse-1', 5, 80, 'Initial stock entered when the product was created.', 'user-1'],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO journal_entry_lines'),
      ['company-1', 'journal-1', 'account-inventory', 'Opening inventory value', 400, 'account-equity', 'Opening stock funded by opening equity'],
    );
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'product.create',
      entityId: 'product-1',
      newValues: { name: dto.name, sku: dto.sku, initialStock: 5 },
    }));
  });

  it('does not place branch-bound opening stock in another branch warehouse or create an unassigned warehouse', async () => {
    memberships.getMembership.mockResolvedValue({ companyId: 'company-1', branchId: 'branch-1', role: 'staff' });
    client.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT id FROM products WHERE company_id')) return { rows: [], rowCount: 0 };
      if (sql.includes('INSERT INTO products')) {
        return { rows: [{ id: 'product-1', company_id: 'company-1', sku: dto.sku, name: dto.name }], rowCount: 1 };
      }
      if (sql.includes('SELECT id FROM warehouses')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });

    await expect(service.create(user, dto as any)).rejects.toThrow(
      'Create an active warehouse in your assigned branch before setting initial stock.',
    );

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('AND ($2::uuid IS NULL OR branch_id = $2)'),
      ['company-1', 'branch-1'],
    );
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO warehouses'))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('inventory_stock_levels'))).toBe(false);
  });

  it('rejects an unclassified product when the company has enabled configured tax', async () => {
    db.query.mockResolvedValue({
      rows: [{ settings: { taxPolicy: { mode: 'configured', vatRegistered: true, standardRate: 16 } } }],
      rowCount: 1,
    });

    await expect(service.create(user, { ...dto, stockQuantity: 0 } as any))
      .rejects.toThrow('Configure this product tax treatment before creating transactions under the company tax policy.');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects initial stock for a service before opening a transaction', async () => {
    await expect(service.create(user, { ...dto, isService: true } as any)).rejects.toThrow(BadRequestException);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('does not create stock rows or movements when initial stock is zero', async () => {
    await service.create(user, { ...dto, stockQuantity: 0 } as any);

    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('inventory_stock_levels'))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('inventory_stock_movements'))).toBe(false);
    expect(accounting.ensureDefaults).not.toHaveBeenCalled();
  });
  it('rejects unsupported image content before writing to storage', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'product-1', company_id: 'company-1', image_url: null, image_storage_key: null }], rowCount: 1 });
    await expect(service.uploadImage(user, 'product-1', { buffer: Buffer.from('<svg></svg>'), mimetype: 'image/svg+xml', size: 11 })).rejects.toThrow(BadRequestException);
    expect(imageStorage.upload).not.toHaveBeenCalled();
  });

  it('blocks image upload when the product is outside the selected company', async () => {
    memberships.getMembershipForCompany.mockResolvedValue({ companyId: 'company-2', branchId: null, role: 'owner' });
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(service.uploadImage({ ...user, companyId: 'company-2' }, 'foreign-product', { buffer: Buffer.from([0xff, 0xd8, 0xff]), mimetype: 'image/jpeg', size: 3 })).rejects.toThrow('Product not found');
    expect(imageStorage.upload).not.toHaveBeenCalled();
  });

  it('stores a replacement image and returns a short-lived signed URL', async () => {
    const existing = { id: 'product-1', company_id: 'company-1', image_url: null, image_storage_key: 'old-key', name: 'Photo product' };
    const updated = { ...existing, image_storage_key: 'companies/company-1/products/product-1/new.jpg', image_url: null };
    db.query.mockImplementation(async (sql: string) => sql.includes('SELECT') ? { rows: [existing], rowCount: 1 } : { rows: [updated], rowCount: 1 });
    const result = await service.uploadImage(user, 'product-1', { buffer: Buffer.from([0xff, 0xd8, 0xff]), mimetype: 'image/jpeg', size: 3 });
    expect(imageStorage.upload).toHaveBeenCalledWith(updated.image_storage_key, expect.any(Buffer), 'image/jpeg');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $2 AND company_id = $3'), [updated.image_storage_key, 'product-1', 'company-1']);
    expect(result.image_url).toBe('signed:' + updated.image_storage_key);
    expect('image_storage_key' in result).toBe(false);
    expect(imageStorage.remove).toHaveBeenCalledWith('old-key');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'product.image.upload', entityId: 'product-1' }));
  });

  it('clears the image reference and removes the saved object', async () => {
    const existing = { id: 'product-1', company_id: 'company-1', image_url: null, image_storage_key: 'old-key', name: 'Photo product' };
    db.query.mockImplementation(async (sql: string) => sql.includes('SELECT') ? { rows: [existing], rowCount: 1 } : { rows: [], rowCount: 1 });
    const result = await service.removeImage(user, 'product-1');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('SET image_storage_key = NULL, image_url = NULL'), ['product-1', 'company-1']);
    expect(imageStorage.remove).toHaveBeenCalledWith('old-key');
    expect(result.image_url).toBeNull();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'product.image.remove', entityId: 'product-1' }));
  });
  it('requires an explicit valid rate before a product can be marked standard-rated', async () => {
    await expect(service.create(user, { ...dto, taxTreatment: 'standard', taxRate: 0 } as any))
      .rejects.toThrow('Standard-rated products require an explicitly configured tax rate');
    expect(db.transaction).not.toHaveBeenCalled();
  });

});
