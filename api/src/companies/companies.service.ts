import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { CompanyRow } from './company.types.js';
import type { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

const COMPANY_COLUMNS = `
  id, name, registration_number, vat_number, currency, timezone,
  address_line1, address_line2, city, county, postal_code,
  phone, email, website, settings, is_active, created_at, updated_at
`;

@Injectable()
export class CompaniesService {
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

  async getMyCompany(user: AuthenticatedUser): Promise<CompanyRow> {
    const membership = await this.membershipFor(user);

    return this.getById(membership.companyId);
  }

  async getById(companyId: string): Promise<CompanyRow> {
    const result = await this.db.query<CompanyRow>(
      `SELECT ${COMPANY_COLUMNS} FROM companies WHERE id = $1`,
      [companyId],
    );

    if (result.rows.length === 0) {
      throw new NotFoundException('Company not found.');
    }

    return result.rows[0];
  }

  async getForUser(user: AuthenticatedUser, companyId: string): Promise<CompanyRow> {
    await this.memberships.getMembershipForCompany(user.userId, companyId);
    return this.getById(companyId);
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateCompanyDto,
  ): Promise<CompanyRow> {
    const membership = await this.memberships.requireOwnerOrAdmin(
      user.userId,
      user.companyId ?? '',
    );

    const existing = await this.db.query<{ id: string }>(
      'SELECT id FROM companies WHERE name = $1 AND id = $2',
      [dto.name, membership.companyId],
    );

    if (existing.rows.length > 0) {
      throw new ConflictException('A company with this name already exists in your organization.');
    }

    const currency = (dto.currency ?? 'KES').toUpperCase();
    const timezone = dto.timezone ?? 'Africa/Nairobi';

    const result = await this.db.query<CompanyRow>(
      `INSERT INTO companies
        (name, registration_number, vat_number, currency, timezone,
         address_line1, address_line2, city, county, postal_code,
         phone, email, website, settings, is_active)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, '{}', true)
       RETURNING ${COMPANY_COLUMNS}`,
      [
        dto.name,
        dto.registrationNumber ?? null,
        dto.vatNumber ?? null,
        currency,
        timezone,
        dto.addressLine1 ?? null,
        dto.addressLine2 ?? null,
        dto.city ?? null,
        dto.county ?? null,
        dto.postalCode ?? null,
        dto.phone ?? null,
        dto.email ?? null,
        dto.website ?? null,
      ],
    );

    const company = result.rows[0];

    await this.audit.log({
      userId: user.userId,
      companyId: company.id,
      branchId: null,
      action: 'company.create',
      entityType: 'company',
      entityId: company.id,
      oldValues: null,
      newValues: { name: dto.name, currency },
      ipAddress: null,
    });

    return company;
  }

  async update(
    user: AuthenticatedUser,
    companyId: string,
    dto: UpdateCompanyDto,
  ): Promise<CompanyRow> {
    await this.memberships.requireOwnerOrAdmin(user.userId, companyId);

    const existing = await this.getById(companyId);
    if (dto.taxPolicy?.mode === 'configured' && dto.taxPolicy.vatRegistered && dto.taxPolicy.standardRate === undefined) {
      // Product-specific rates are allowed, but the company must explicitly configure a standard rate for policy completeness.
      throw new ConflictException('A VAT-registered company must configure its standard VAT rate before enabling configured tax policy.');
    }

    const fields: string[] = [];
    const values: (string | boolean | null)[] = [];
    let paramIndex = 1;

    const fieldMap: Record<string, string> = {
      name: 'name',
      registrationNumber: 'registration_number',
      vatNumber: 'vat_number',
      currency: 'currency',
      timezone: 'timezone',
      addressLine1: 'address_line1',
      addressLine2: 'address_line2',
      city: 'city',
      county: 'county',
      postalCode: 'postal_code',
      phone: 'phone',
      email: 'email',
      website: 'website',
      isActive: 'is_active',
    };

    if (dto.taxPolicy !== undefined) {
      fields.push(`settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{taxPolicy}', ${paramIndex}::jsonb, true)`);
      values.push(JSON.stringify(dto.taxPolicy));
      paramIndex++;
    }

    for (const [dtoKey, dbColumn] of Object.entries(fieldMap)) {
      if (dtoKey in dto) {
        const value = (dto as Record<string, unknown>)[dtoKey];
        if (dtoKey === 'currency' && typeof value === 'string') {
          fields.push(`${dbColumn} = $${paramIndex}`);
          values.push(value.toUpperCase());
        } else {
          fields.push(`${dbColumn} = $${paramIndex}`);
          values.push(value as string | boolean | null);
        }
        paramIndex++;
      }
    }

    if (fields.length === 0) {
      return existing;
    }

    fields.push(`updated_at = NOW()`);
    values.push(companyId);

    const result = await this.db.query<CompanyRow>(
      `UPDATE companies SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING ${COMPANY_COLUMNS}`,
      values,
    );

    if (result.rows.length === 0) {
      throw new NotFoundException('Company not found.');
    }

    const updated = result.rows[0];

    await this.audit.log({
      userId: user.userId,
      companyId: updated.id,
      branchId: null,
      action: 'company.update',
      entityType: 'company',
      entityId: updated.id,
      oldValues: { name: existing.name },
      newValues: { name: updated.name },
      ipAddress: null,
    });

    return updated;
  }
}
