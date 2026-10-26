import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { CustomerRow } from './customer.types.js';
import type { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

const CUSTOMER_COLUMNS = `
  id, company_id, name, email, phone, city, county, address_line1,
  postal_code, credit_limit, outstanding_balance, status, is_active,
  created_at, updated_at
`;

@Injectable()
export class CustomersService {
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

  private redactCompanyWideBalance<T extends CustomerRow>(customer: T, branchId?: string | null): T {
    if (!branchId) return customer;
    return { ...customer, outstanding_balance: null } as T;
  }

  async list(user: AuthenticatedUser, search?: string): Promise<CustomerRow[]> {
    const membership = await this.membershipFor(user);

    if (search) {
      const result = await this.db.query<CustomerRow>(
        `SELECT ${CUSTOMER_COLUMNS} FROM customers
         WHERE company_id = $1 AND (name ILIKE $2 OR email ILIKE $2 OR phone ILIKE $2)
         ORDER BY created_at DESC`,
        [membership.companyId, `%${search}%`],
      );
      return result.rows.map((customer) => this.redactCompanyWideBalance(customer, membership.branchId));
    }

    const result = await this.db.query<CustomerRow>(
      `SELECT ${CUSTOMER_COLUMNS} FROM customers
       WHERE company_id = $1 ORDER BY created_at DESC`,
      [membership.companyId],
    );
    return result.rows.map((customer) => this.redactCompanyWideBalance(customer, membership.branchId));
  }

  async getById(user: AuthenticatedUser, customerId: string): Promise<CustomerRow> {
    const membership = await this.membershipFor(user);
    return this.redactCompanyWideBalance(await this.getByIdInternal(membership.companyId, customerId), membership.branchId);
  }

  async create(user: AuthenticatedUser, dto: CreateCustomerDto): Promise<CustomerRow> {
    const membership = await this.membershipFor(user);

    if (dto.email) {
      const existing = await this.db.query<{ id: string }>(
        'SELECT id FROM customers WHERE company_id = $1 AND email = $2',
        [membership.companyId, dto.email],
      );
      if (existing.rows.length > 0) {
        throw new ConflictException('A customer with this email already exists.');
      }
    }

    const result = await this.db.query<CustomerRow>(
      `INSERT INTO customers
        (company_id, name, email, phone, city, county, address_line1,
         postal_code, credit_limit, status, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', true)
       RETURNING ${CUSTOMER_COLUMNS}`,
      [
        membership.companyId,
        dto.name,
        dto.email ?? null,
        dto.phone ?? null,
        dto.city ?? null,
        dto.county ?? null,
        dto.addressLine1 ?? null,
        dto.postalCode ?? null,
        dto.creditLimit ?? 0,
      ],
    );

    const customer = result.rows[0];

    await this.audit.log({
      userId: user.userId,
      companyId: membership.companyId,
      branchId: null,
      action: 'customer.create',
      entityType: 'customer',
      entityId: customer.id,
      oldValues: null,
      newValues: { name: dto.name, email: dto.email ?? null },
      ipAddress: null,
    });

    return this.redactCompanyWideBalance(customer, membership.branchId);
  }

  async update(
    user: AuthenticatedUser,
    customerId: string,
    dto: UpdateCustomerDto,
  ): Promise<CustomerRow> {
    const membership = await this.membershipFor(user);
    const existing = await this.getByIdInternal(membership.companyId, customerId);

    if (dto.email && dto.email !== existing.email) {
      const dup = await this.db.query<{ id: string }>(
        'SELECT id FROM customers WHERE company_id = $1 AND email = $2 AND id != $3',
        [membership.companyId, dto.email, customerId],
      );
      if (dup.rows.length > 0) {
        throw new ConflictException('A customer with this email already exists.');
      }
    }

    const fields: string[] = [];
    const values: (string | number | null)[] = [];
    let paramIndex = 1;

    const fieldMap: Record<string, string> = {
      name: 'name',
      email: 'email',
      phone: 'phone',
      city: 'city',
      county: 'county',
      addressLine1: 'address_line1',
      postalCode: 'postal_code',
      creditLimit: 'credit_limit',
      status: 'status',
    };

    for (const [dtoKey, dbColumn] of Object.entries(fieldMap)) {
      if (dtoKey in dto) {
        const value = (dto as Record<string, unknown>)[dtoKey];
        fields.push(`${dbColumn} = $${paramIndex}`);
        values.push(value as string | number | null);
        paramIndex++;
      }
    }

    if (fields.length === 0) {
      return existing;
    }

    fields.push('updated_at = NOW()');
    values.push(customerId);
    values.push(membership.companyId);

    const result = await this.db.query<CustomerRow>(
      `UPDATE customers SET ${fields.join(', ')}
       WHERE id = $${paramIndex} AND company_id = $${paramIndex + 1}
       RETURNING ${CUSTOMER_COLUMNS}`,
      values,
    );

    if (result.rows.length === 0) {
      throw new NotFoundException('Customer not found.');
    }

    const updated = result.rows[0];

    await this.audit.log({
      userId: user.userId,
      companyId: membership.companyId,
      branchId: null,
      action: 'customer.update',
      entityType: 'customer',
      entityId: updated.id,
      oldValues: { name: existing.name },
      newValues: { name: updated.name },
      ipAddress: null,
    });

    return this.redactCompanyWideBalance(updated, membership.branchId);
  }

  async delete(user: AuthenticatedUser, customerId: string): Promise<void> {
    const membership = await this.membershipFor(user);
    const existing = await this.getByIdInternal(membership.companyId, customerId);

    await this.db.query(
      'DELETE FROM customers WHERE id = $1 AND company_id = $2',
      [customerId, membership.companyId],
    );

    await this.audit.log({
      userId: user.userId,
      companyId: membership.companyId,
      branchId: null,
      action: 'customer.delete',
      entityType: 'customer',
      entityId: existing.id,
      oldValues: { name: existing.name },
      newValues: null,
      ipAddress: null,
    });
  }

  private async getByIdInternal(companyId: string, customerId: string): Promise<CustomerRow> {
    const result = await this.db.query<CustomerRow>(
      `SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE id = $1 AND company_id = $2`,
      [customerId, companyId],
    );
    if (result.rows.length === 0) {
      throw new NotFoundException('Customer not found.');
    }
    return result.rows[0];
  }
}
