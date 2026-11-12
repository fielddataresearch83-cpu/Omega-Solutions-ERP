import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { SupplierRow } from './supplier.types.js';
import type { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

const SUPPLIER_COLUMNS = `
  id, company_id, name, email, phone, city, county, address_line1,
  postal_code, contact_person, payment_terms, outstanding_balance,
  status, is_active, created_at, updated_at
`;

@Injectable()
export class SuppliersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly memberships: MembershipsService,
    private readonly audit: AuditService,
  ) {}

  private async membershipFor(user: AuthenticatedUser) {
    return user.companyId
      ? this.memberships.getMembershipForCompany(user.userId, user.companyId)
      : this.memberships.getMembership(user.userId);
  }

  private assertCompanyWide(membership: { branchId?: string | null }) {
    if (membership.branchId) {
      throw new ForbiddenException('Supplier records are company-wide. A company-wide procurement member must access them.');
    }
  }

  async list(user: AuthenticatedUser, search?: string): Promise<SupplierRow[]> {
    const membership = await this.membershipFor(user);
    this.assertCompanyWide(membership);

    if (search) {
      const result = await this.db.query<SupplierRow>(
        `SELECT ${SUPPLIER_COLUMNS} FROM suppliers
         WHERE company_id = $1 AND (name ILIKE $2 OR email ILIKE $2 OR phone ILIKE $2)
         ORDER BY created_at DESC`,
        [membership.companyId, `%${search}%`],
      );
      return result.rows;
    }

    const result = await this.db.query<SupplierRow>(
      `SELECT ${SUPPLIER_COLUMNS} FROM suppliers
       WHERE company_id = $1 ORDER BY created_at DESC`,
      [membership.companyId],
    );
    return result.rows;
  }

  async getById(user: AuthenticatedUser, supplierId: string): Promise<SupplierRow> {
    const membership = await this.membershipFor(user);
    this.assertCompanyWide(membership);
    return this.getByIdInternal(membership.companyId, supplierId);
  }

  async create(user: AuthenticatedUser, dto: CreateSupplierDto): Promise<SupplierRow> {
    const membership = await this.membershipFor(user);
    this.assertCompanyWide(membership);

    if (dto.email) {
      const existing = await this.db.query<{ id: string }>(
        'SELECT id FROM suppliers WHERE company_id = $1 AND email = $2',
        [membership.companyId, dto.email],
      );
      if (existing.rows.length > 0) {
        throw new ConflictException('A supplier with this email already exists.');
      }
    }

    const result = await this.db.query<SupplierRow>(
      `INSERT INTO suppliers
        (company_id, name, email, phone, city, county, address_line1,
         postal_code, contact_person, payment_terms, status, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', true)
       RETURNING ${SUPPLIER_COLUMNS}`,
      [
        membership.companyId,
        dto.name,
        dto.email ?? null,
        dto.phone ?? null,
        dto.city ?? null,
        dto.county ?? null,
        dto.addressLine1 ?? null,
        dto.postalCode ?? null,
        dto.contactPerson ?? null,
        dto.paymentTerms ?? null,
      ],
    );

    const supplier = result.rows[0];

    await this.audit.log({
      userId: user.userId,
      companyId: membership.companyId,
      branchId: null,
      action: 'supplier.create',
      entityType: 'supplier',
      entityId: supplier.id,
      oldValues: null,
      newValues: { name: dto.name },
      ipAddress: null,
    });

    return supplier;
  }

  async update(
    user: AuthenticatedUser,
    supplierId: string,
    dto: UpdateSupplierDto,
  ): Promise<SupplierRow> {
    const membership = await this.membershipFor(user);
    this.assertCompanyWide(membership);
    const existing = await this.getByIdInternal(membership.companyId, supplierId);

    if (dto.email && dto.email !== existing.email) {
      const dup = await this.db.query<{ id: string }>(
        'SELECT id FROM suppliers WHERE company_id = $1 AND email = $2 AND id != $3',
        [membership.companyId, dto.email, supplierId],
      );
      if (dup.rows.length > 0) {
        throw new ConflictException('A supplier with this email already exists.');
      }
    }

    const fields: string[] = [];
    const values: (string | null)[] = [];
    let paramIndex = 1;

    const fieldMap: Record<string, string> = {
      name: 'name',
      email: 'email',
      phone: 'phone',
      city: 'city',
      county: 'county',
      addressLine1: 'address_line1',
      postalCode: 'postal_code',
      contactPerson: 'contact_person',
      paymentTerms: 'payment_terms',
      status: 'status',
    };

    for (const [dtoKey, dbColumn] of Object.entries(fieldMap)) {
      if (dtoKey in dto) {
        const value = (dto as Record<string, unknown>)[dtoKey];
        fields.push(`${dbColumn} = $${paramIndex}`);
        values.push(value as string | null);
        paramIndex++;
      }
    }

    if (fields.length === 0) {
      return existing;
    }

    if ('status' in dto) {
      const statusParam = paramIndex - 1;
      fields.push("is_active = CASE WHEN $" + statusParam + " = 'inactive' THEN false WHEN $" + statusParam + " = 'active' THEN true ELSE is_active END");
    }

    fields.push('updated_at = NOW()');
    values.push(supplierId);
    values.push(membership.companyId);

    const result = await this.db.query<SupplierRow>(
      `UPDATE suppliers SET ${fields.join(', ')}
       WHERE id = $${paramIndex} AND company_id = $${paramIndex + 1}
       RETURNING ${SUPPLIER_COLUMNS}`,
      values,
    );

    if (result.rows.length === 0) {
      throw new NotFoundException('Supplier not found.');
    }

    const updated = result.rows[0];

    await this.audit.log({
      userId: user.userId,
      companyId: membership.companyId,
      branchId: null,
      action: 'supplier.update',
      entityType: 'supplier',
      entityId: updated.id,
      oldValues: { name: existing.name },
      newValues: { name: updated.name },
      ipAddress: null,
    });

    return updated;
  }

  async delete(user: AuthenticatedUser, supplierId: string): Promise<void> {
    const membership = await this.membershipFor(user);
    this.assertCompanyWide(membership);
    await this.db.transaction(async client => {
      const found = await client.query<SupplierRow>(
        `SELECT ${SUPPLIER_COLUMNS} FROM suppliers WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [supplierId, membership.companyId],
      );
      const existing = found.rows[0];
      if (!existing) throw new NotFoundException('Supplier not found.');

      if (!existing.is_active && existing.status === 'inactive') return;

      // Suppliers are referenced by purchase orders, bills and payment history.
      // Archive instead of hard deleting so historical procurement and audit records remain intact.
      await client.query(
        `UPDATE suppliers SET status='inactive',is_active=false,updated_at=NOW()
         WHERE id=$1 AND company_id=$2`,
        [supplierId, membership.companyId],
      );

      await this.audit.logInTransaction(client, {
        userId: user.userId,
        companyId: membership.companyId,
        branchId: null,
        action: 'supplier.archive',
        entityType: 'supplier',
        entityId: existing.id,
        oldValues: { name: existing.name, status: existing.status, isActive: existing.is_active },
        newValues: { status: 'inactive', isActive: false },
        ipAddress: null,
      });
    });
  }

  private async getByIdInternal(companyId: string, supplierId: string): Promise<SupplierRow> {
    const result = await this.db.query<SupplierRow>(
      `SELECT ${SUPPLIER_COLUMNS} FROM suppliers WHERE id = $1 AND company_id = $2`,
      [supplierId, companyId],
    );
    if (result.rows.length === 0) {
      throw new NotFoundException('Supplier not found.');
    }
    return result.rows[0];
  }
}
