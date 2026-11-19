import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { CompanyRow } from './company.types.js';
import type { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import { readCompanyTaxPolicy } from '../tax/tax-policy.js';

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

  async listArchived(user: AuthenticatedUser): Promise<CompanyRow[]> {
    const result = await this.db.query<CompanyRow>(
      `SELECT DISTINCT c.id, c.name, c.registration_number, c.vat_number, c.currency, c.timezone,
              c.address_line1, c.address_line2, c.city, c.county, c.postal_code,
              c.phone, c.email, c.website, c.settings, c.is_active, c.created_at, c.updated_at
       FROM companies c
       JOIN company_memberships cm ON cm.company_id = c.id
       WHERE cm.user_id = $1 AND cm.is_active = true
         AND cm.role IN ('owner', 'admin') AND c.is_active = false
       ORDER BY c.name ASC`,
      [user.userId],
    );
    return result.rows;
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
    try {
      await this.memberships.getMembershipForCompany(user.userId, companyId);
    } catch {
      // Archived companies are excluded by the normal membership lookup. Permit
      // an existing active owner/admin membership to reach the restore action.
      const membership = await this.db.query<{ role: string; is_active: boolean }>(
        `SELECT cm.role, c.is_active
         FROM company_memberships cm
         JOIN companies c ON c.id = cm.company_id
         WHERE cm.user_id = $1 AND cm.company_id = $2 AND cm.is_active = true
         LIMIT 1`,
        [user.userId, companyId],
      );
      const row = membership?.rows?.[0];
      if (!row || row.is_active || !['owner', 'admin'].includes(row.role)) {
        throw new ForbiddenException('You do not have access to this company.');
      }
    }
    return this.getById(companyId);
  }

  private async requireCompanyOwner(userId: string, companyId: string): Promise<void> {
    const result = await this.db.query<{ role: string }>(
      `SELECT role FROM company_memberships
       WHERE user_id = $1 AND company_id = $2 AND is_active = true LIMIT 1`,
      [userId, companyId],
    );
    if (!result.rows[0] || !['owner', 'admin'].includes(result.rows[0].role)) {
      throw new ForbiddenException('Only an active company owner or administrator can archive or restore this company.');
    }
  }

  async archive(user: AuthenticatedUser, companyId: string) {
    await this.requireCompanyOwner(user.userId, companyId);
    const company = await this.getById(companyId);
    if (!company.is_active) return { success: true, is_active: false };
    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE companies SET is_active = false, updated_at = NOW() WHERE id = $1 AND is_active = true`,
        [companyId],
      );
      await this.audit.logInTransaction(client, {
        userId: user.userId, companyId, branchId: user.branchId ?? null,
        action: 'company.archived', entityType: 'company', entityId: companyId,
        oldValues: { is_active: true }, newValues: { is_active: false }, ipAddress: null,
      });
    });
    return { success: true, is_active: false };
  }

  async restore(user: AuthenticatedUser, companyId: string) {
    await this.requireCompanyOwner(user.userId, companyId);
    const company = await this.getById(companyId);
    if (company.is_active) return { success: true, is_active: true };
    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE companies SET is_active = true, updated_at = NOW() WHERE id = $1 AND is_active = false`,
        [companyId],
      );
      await this.audit.logInTransaction(client, {
        userId: user.userId, companyId, branchId: user.branchId ?? null,
        action: 'company.restored', entityType: 'company', entityId: companyId,
        oldValues: { is_active: false }, newValues: { is_active: true }, ipAddress: null,
      });
    });
    return { success: true, is_active: true };
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateCompanyDto,
  ): Promise<CompanyRow> {
    await this.memberships.requireOwnerOrAdmin(
      user.userId,
      user.companyId ?? '',
    );

    // A newly created tenant must have an owner membership in the same
    // transaction; otherwise the creator can create a company they cannot access.
    const currency = (dto.currency ?? 'KES').toUpperCase();
    const timezone = dto.timezone ?? 'Africa/Nairobi';

    const company = await this.db.transaction(async (client) => {
      const result = await client.query<CompanyRow>(
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
      const createdCompany = result.rows[0];
      await client.query(
        `INSERT INTO company_memberships (user_id, company_id, role, is_active)
         VALUES ($1, $2, 'owner', true)`,
        [user.userId, createdCompany.id],
      );
      return createdCompany;
    });

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
    if (dto.taxPolicy !== undefined) readCompanyTaxPolicy({ taxPolicy: dto.taxPolicy });

    const fields: string[] = [];
    const values: (string | boolean | null)[] = [];
    let paramIndex = 1;

    if (dto.fiscalYearStart !== undefined) {
      fields.push(`settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{fiscalYearStart}', to_jsonb($${paramIndex}::text), true)`);
      values.push(dto.fiscalYearStart);
      paramIndex++;
    }

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
      fields.push(`settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{taxPolicy}', $${paramIndex}::jsonb, true)`);
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
      oldValues: { name: existing.name, currency: existing.currency, fiscalYearStart: existing.settings?.fiscalYearStart ?? 'January', taxPolicy: existing.settings?.taxPolicy ?? null },
      newValues: { name: updated.name, currency: updated.currency, fiscalYearStart: updated.settings?.fiscalYearStart ?? 'January', taxPolicy: updated.settings?.taxPolicy ?? null },
      ipAddress: null,
    });

    return updated;
  }
}
