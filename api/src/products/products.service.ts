import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { ProductRow } from './product.types.js';
import type { CreateProductDto, UpdateProductDto } from './dto/product.dto.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { ProductImageStorageService } from './product-image-storage.service.js';

const PRODUCT_COLUMNS = `
  id, company_id, sku, name, description, image_url, image_storage_key, category, unit,
  selling_price, cost_price, stock_quantity, reorder_level, tax_treatment, tax_rate,
  is_service, is_active, created_at, updated_at
`;

@Injectable()
export class ProductsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly memberships: MembershipsService,
    private readonly audit: AuditService,
    private readonly accounting: AccountingService,
    private readonly imageStorage: ProductImageStorageService,
  ) {}

  private async resolveMembership(user: AuthenticatedUser) {
    // Respect the company selected in the signed access token. Falling back to
    // the user's default membership when a company is selected can cross tenants.
    if (user.companyId) {
      return this.memberships.getMembershipForCompany(user.userId, user.companyId);
    }
    return this.memberships.getMembership(user.userId);
  }

  async list(user: AuthenticatedUser, search?: string): Promise<ProductRow[]> {
    const membership = await this.resolveMembership(user);

    if (search) {
      const result = await this.db.query<ProductRow>(
        `SELECT ${PRODUCT_COLUMNS} FROM products
         WHERE company_id = $1 AND (name ILIKE $2 OR sku ILIKE $2 OR category ILIKE $2)
         ORDER BY created_at DESC`,
        [membership.companyId, `%${search}%`],
      );
      return Promise.all(result.rows.map((row) => this.withImageUrl(row)));
    }

    const result = await this.db.query<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products
       WHERE company_id = $1 ORDER BY created_at DESC`,
      [membership.companyId],
    );
    return Promise.all(result.rows.map((row) => this.withImageUrl(row)));
  }

  async getById(user: AuthenticatedUser, productId: string): Promise<ProductRow> {
    const membership = await this.resolveMembership(user);
    return this.withImageUrl(await this.getByIdInternal(membership.companyId, productId));
  }

  async create(user: AuthenticatedUser, dto: CreateProductDto): Promise<ProductRow> {
    const membership = await this.resolveMembership(user);
    const initialStock = dto.stockQuantity ?? 0;
    const isService = dto.isService ?? false;
    if (dto.taxTreatment === 'standard' && !(Number(dto.taxRate) > 0 && Number(dto.taxRate) <= 100)) {
      throw new BadRequestException('Standard-rated products require an explicitly configured tax rate greater than 0 and no more than 100%.');
    }

    if (isService && initialStock > 0) {
      throw new BadRequestException('Service items cannot have an initial stock quantity.');
    }

    if (!isService && initialStock > 0 && Number(dto.costPrice ?? 0) > 0) {
      await this.accounting.ensureDefaults(membership.companyId);
    }

    const product = await this.db.transaction(async (client) => {
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM products WHERE company_id = $1 AND sku = $2',
        [membership.companyId, dto.sku],
      );
      if (existing.rows.length > 0) {
        throw new ConflictException('A product with this SKU already exists.');
      }

      const result = await client.query<ProductRow>(
        `INSERT INTO products
          (company_id, sku, name, description, image_url, category, unit,
           selling_price, cost_price, stock_quantity, reorder_level, tax_treatment, tax_rate,
           is_service, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING ${PRODUCT_COLUMNS}`,
        [
          membership.companyId,
          dto.sku,
          dto.name,
          dto.description ?? null,
          dto.imageUrl ?? null,
          dto.category ?? null,
          dto.unit ?? 'pcs',
          dto.sellingPrice,
          dto.costPrice ?? 0,
          isService ? 0 : initialStock,
          dto.reorderLevel ?? 0,
          dto.taxTreatment ?? 'legacy',
          dto.taxRate ?? 0,
          isService,
          dto.isActive ?? true,
        ],
      );
      const created = result.rows[0];

      if (!isService && initialStock > 0) {
        let warehouse = await client.query<{ id: string }>(
          `SELECT id FROM warehouses
           WHERE company_id = $1 AND is_active = true
             AND ($2::uuid IS NULL OR branch_id = $2)
           ORDER BY created_at ASC, id ASC LIMIT 1`,
          [membership.companyId, membership.branchId],
        );

        // Only company-wide members may create the legacy company-wide default.
        // A branch-bound member must never place opening stock into another
        // branch's warehouse or create an unassigned warehouse as a workaround.
        if (!warehouse.rows[0] && !membership.branchId) {
          warehouse = await client.query<{ id: string }>(
            `INSERT INTO warehouses(company_id, code, name, capacity, is_active)
             VALUES($1, 'MAIN', 'Main Warehouse', 0, true)
             ON CONFLICT(company_id, code) DO UPDATE SET is_active = warehouses.is_active
             RETURNING id`,
            [membership.companyId],
          );
          if (!warehouse.rows[0]) {
            warehouse = await client.query<{ id: string }>(
              `SELECT id FROM warehouses
               WHERE company_id = $1 AND is_active = true
               ORDER BY created_at ASC, id ASC LIMIT 1`,
              [membership.companyId],
            );
          }
        }

        const warehouseId = warehouse.rows[0]?.id;
        if (!warehouseId) {
          throw new BadRequestException(
            membership.branchId
              ? 'Create an active warehouse in your assigned branch before setting initial stock.'
              : 'Create an active warehouse before setting initial stock.',
          );
        }

        await client.query(
          `INSERT INTO inventory_stock_levels(company_id, warehouse_id, product_id, quantity, reorder_level)
           VALUES($1, $2, $3, $4, $5)
           ON CONFLICT(warehouse_id, product_id) DO UPDATE
             SET quantity = EXCLUDED.quantity, reorder_level = EXCLUDED.reorder_level, updated_at = NOW()`,
          [membership.companyId, warehouseId, created.id, initialStock, dto.reorderLevel ?? 0],
        );

        await client.query(
          `INSERT INTO inventory_stock_movements
             (company_id, product_id, warehouse_id, movement_type, quantity, unit_cost, notes, created_by)
           VALUES($1, $2, $3, 'opening_balance', $4, $5, $6, $7)`,
          [
            membership.companyId,
            created.id,
            warehouseId,
            initialStock,
            dto.costPrice ?? 0,
            'Initial stock entered when the product was created.',
            user.userId,
          ],
        );

        const openingValue = Math.round(initialStock * Number(dto.costPrice ?? 0) * 100) / 100;
        if (openingValue > 0) {
          const year = new Date().getFullYear();
          const seq = await client.query<{ next_number: number }>(
            `INSERT INTO journal_entry_sequences(company_id,entry_year,next_number) VALUES($1,$2,1)
             ON CONFLICT(company_id,entry_year) DO UPDATE SET next_number=journal_entry_sequences.next_number+1
             RETURNING next_number`,
            [membership.companyId, year],
          );
          const entryNumber = `JE-${year}-${String(seq.rows[0].next_number).padStart(6, '0')}`;
          const entry = await client.query<{ id: string }>(
            `INSERT INTO journal_entries(company_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by)
             VALUES($1,$2,CURRENT_DATE,$3,'inventory_opening_balance',$4,'posted',NOW(),$5) RETURNING id`,
            [membership.companyId, entryNumber, `Opening inventory balance for ${created.name}`, created.id, user.userId],
          );
          const accounts = await client.query<{ id: string; system_code: string }>(
            `SELECT id,system_code FROM chart_of_accounts
             WHERE company_id=$1 AND system_code IN ('inventory','equity') AND is_active=true`,
            [membership.companyId],
          );
          const inventoryAccount = accounts.rows.find((account) => account.system_code === 'inventory');
          const equityAccount = accounts.rows.find((account) => account.system_code === 'equity');
          if (!inventoryAccount || !equityAccount) {
            throw new BadRequestException('Required inventory and equity accounts must be active to post opening stock value.');
          }
          await client.query(
            `INSERT INTO journal_entry_lines(company_id,journal_entry_id,account_id,description,debit,credit)
             VALUES($1,$2,$3,$4,$5,0),($1,$2,$6,$7,0,$5)`,
            [membership.companyId, entry.rows[0].id, inventoryAccount.id, 'Opening inventory value', openingValue,
              equityAccount.id, 'Opening stock funded by opening equity'],
          );
        }
      }

      return created;
    });

    await this.audit.log({
      userId: user.userId,
      companyId: membership.companyId,
      branchId: membership.branchId,
      action: 'product.create',
      entityType: 'product',
      entityId: product.id,
      oldValues: null,
      newValues: { name: dto.name, sku: dto.sku, initialStock },
      ipAddress: null,
    });

    return this.withImageUrl(product);
  }

  async update(
    user: AuthenticatedUser,
    productId: string,
    dto: UpdateProductDto,
  ): Promise<ProductRow> {
    const membership = await this.resolveMembership(user);
    const existing = await this.getByIdInternal(membership.companyId, productId);
    const resultingTreatment = dto.taxTreatment ?? existing.tax_treatment ?? 'legacy';
    const resultingRate = dto.taxRate ?? Number(existing.tax_rate ?? 0);
    if (resultingTreatment === 'standard' && !(resultingRate > 0 && resultingRate <= 100)) {
      throw new BadRequestException('Standard-rated products require an explicitly configured tax rate greater than 0 and no more than 100%.');
    }

    if (dto.stockQuantity !== undefined && Number(dto.stockQuantity) !== Number(existing.stock_quantity)) {
      throw new BadRequestException('Use Inventory > Stock Movements to change stock quantities so the stock ledger remains accurate.');
    }

    if (dto.sku && dto.sku !== existing.sku) {
      const dup = await this.db.query<{ id: string }>(
        'SELECT id FROM products WHERE company_id = $1 AND sku = $2 AND id != $3',
        [membership.companyId, dto.sku, productId],
      );
      if (dup.rows.length > 0) {
        throw new ConflictException('A product with this SKU already exists.');
      }
    }

    const fields: string[] = [];
    const values: (string | number | boolean | null)[] = [];
    let paramIndex = 1;

    const fieldMap: Record<string, string> = {
      sku: 'sku',
      name: 'name',
      description: 'description',
      imageUrl: 'image_url',
      category: 'category',
      unit: 'unit',
      sellingPrice: 'selling_price',
      costPrice: 'cost_price',
      reorderLevel: 'reorder_level',
      taxTreatment: 'tax_treatment',
      taxRate: 'tax_rate',
      isService: 'is_service',
      isActive: 'is_active',
    };

    for (const [dtoKey, dbColumn] of Object.entries(fieldMap)) {
      if (dtoKey in dto) {
        const value = (dto as Record<string, unknown>)[dtoKey];
        fields.push(`${dbColumn} = $${paramIndex}`);
        values.push(value as string | number | boolean | null);
        paramIndex++;
      }
    }

    if (fields.length === 0) {
      return this.withImageUrl(existing);
    }

    fields.push('updated_at = NOW()');
    values.push(productId);
    values.push(membership.companyId);

    const result = await this.db.query<ProductRow>(
      `UPDATE products SET ${fields.join(', ')}
       WHERE id = $${paramIndex} AND company_id = $${paramIndex + 1}
       RETURNING ${PRODUCT_COLUMNS}`,
      values,
    );

    if (result.rows.length === 0) {
      throw new NotFoundException('Product not found.');
    }

    const updated = result.rows[0];

    await this.audit.log({
      userId: user.userId,
      companyId: membership.companyId,
      branchId: membership.branchId,
      action: 'product.update',
      entityType: 'product',
      entityId: updated.id,
      oldValues: { name: existing.name },
      newValues: { name: updated.name },
      ipAddress: null,
    });

    return this.withImageUrl(updated);
  }

  async uploadImage(user: AuthenticatedUser, productId: string, file: { buffer: Buffer; mimetype: string; size: number }) {
    const membership = await this.resolveMembership(user);
    const existing = await this.getByIdInternal(membership.companyId, productId);
    if (!file?.buffer || file.size < 1 || file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Choose an image between 1 byte and 5 MB.');
    }
    const signatures: Array<{ type: string; ext: 'jpg' | 'png' | 'webp'; ok: (b: Buffer) => boolean }> = [
      { type: 'image/jpeg', ext: 'jpg', ok: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
      { type: 'image/png', ext: 'png', ok: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) },
      { type: 'image/webp', ext: 'webp', ok: (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
    ];
    const imageType = signatures.find((item) => item.ok(file.buffer));
    if (!imageType || file.mimetype !== imageType.type) {
      throw new BadRequestException('Only valid JPEG, PNG, and WebP images are supported. SVG and other file types are not allowed.');
    }
    const key = this.imageStorage.newKey(membership.companyId, productId, imageType.ext);
    await this.imageStorage.upload(key, file.buffer, imageType.type);
    let result;
    try {
      result = await this.db.query<ProductRow>(
        'UPDATE products SET image_storage_key = $1, image_url = NULL, updated_at = NOW() WHERE id = $2 AND company_id = $3 RETURNING ' + PRODUCT_COLUMNS,
        [key, productId, membership.companyId],
      );
      if (!result.rows[0]) throw new NotFoundException('Product not found.');
    } catch (error) {
      try { await this.imageStorage.remove(key); } catch { /* Preserve the database error. */ }
      throw error;
    }
    await this.audit.log({ userId: user.userId, companyId: membership.companyId, branchId: membership.branchId, action: 'product.image.upload', entityType: 'product', entityId: productId, oldValues: { hadImage: !!existing.image_url || !!existing.image_storage_key }, newValues: { imageType: imageType.type }, ipAddress: null });
    if (existing.image_storage_key) {
      try { await this.imageStorage.remove(String(existing.image_storage_key)); } catch { /* New key is committed; old object cleanup can be retried safely. */ }
    }
    return this.withImageUrl(result.rows[0]);
  }

  async removeImage(user: AuthenticatedUser, productId: string) {
    const membership = await this.resolveMembership(user);
    const existing = await this.getByIdInternal(membership.companyId, productId);
    await this.db.query('UPDATE products SET image_storage_key = NULL, image_url = NULL, updated_at = NOW() WHERE id = $1 AND company_id = $2', [productId, membership.companyId]);
    await this.audit.log({ userId: user.userId, companyId: membership.companyId, branchId: membership.branchId, action: 'product.image.remove', entityType: 'product', entityId: productId, oldValues: { hadImage: !!existing.image_url || !!existing.image_storage_key }, newValues: null, ipAddress: null });
    if (existing.image_storage_key) await this.imageStorage.remove(String(existing.image_storage_key));
    return this.withImageUrl({ ...existing, image_url: null, image_storage_key: null });
  }

  private withImageUrl(row: ProductRow): ProductRow {
    const { image_storage_key: storageKey, ...publicRow } = row;
    return { ...publicRow, image_url: storageKey ? this.imageStorage.signedReadUrl(String(storageKey)) : row.image_url } as ProductRow;
  }

  async delete(user: AuthenticatedUser, productId: string): Promise<void> {
    const membership = await this.resolveMembership(user);
    const existing = await this.getByIdInternal(membership.companyId, productId);

    await this.db.query(
      'DELETE FROM products WHERE id = $1 AND company_id = $2',
      [productId, membership.companyId],
    );

    await this.audit.log({
      userId: user.userId,
      companyId: membership.companyId,
      branchId: membership.branchId,
      action: 'product.delete',
      entityType: 'product',
      entityId: existing.id,
      oldValues: { name: existing.name },
      newValues: null,
      ipAddress: null,
    });
  }

  private async getByIdInternal(companyId: string, productId: string): Promise<ProductRow> {
    const result = await this.db.query<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1 AND company_id = $2`,
      [productId, companyId],
    );
    if (result.rows.length === 0) {
      throw new NotFoundException('Product not found.');
    }
    return result.rows[0];
  }
}
