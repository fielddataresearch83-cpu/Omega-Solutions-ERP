import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { BranchRow } from './branch.types.js';
import type { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';

const BRANCH_COLUMNS = `
  id, company_id, name, code, address_line1, address_line2,
  city, county, postal_code, phone, email, is_active, created_at, updated_at
`;

@Injectable()
export class BranchesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly memberships: MembershipsService,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async listByCompany(user: AuthenticatedUser, companyId: string): Promise<BranchRow[]> {
    await this.memberships.getMembershipForCompany(user.userId, companyId);

    const result = await this.db.query<BranchRow>(
      `SELECT ${BRANCH_COLUMNS} FROM branches WHERE company_id = $1 ORDER BY created_at`,
      [companyId],
    );

    return result.rows;
  }

  async getById(user: AuthenticatedUser, companyId: string, branchId: string): Promise<BranchRow> {
    await this.memberships.getMembershipForCompany(user.userId, companyId);

    return this.getByIdInternal(companyId, branchId);
  }

  async create(
    user: AuthenticatedUser,
    companyId: string,
    dto: CreateBranchDto,
  ): Promise<BranchRow> {
    await this.memberships.requireRole(user.userId, companyId, ['owner', 'admin', 'manager']);

    const branch = await this.db.transaction(async (client) => {
      // Lock the subscription row and count/insert on the same transaction so concurrent
      // branch creation requests cannot both consume the final plan slot.
      await this.subscriptions.assertBranchCapacity(companyId, client);

      if (dto.code) {
        const existing = await client.query<{ id: string }>(
          'SELECT id FROM branches WHERE company_id = $1 AND code = $2',
          [companyId, dto.code],
        );

        if (existing.rows.length > 0) {
          throw new ConflictException('A branch with this code already exists for this company.');
        }
      }

      const result = await client.query<BranchRow>(
        `INSERT INTO branches
          (company_id, name, code, address_line1, address_line2, city,
           county, postal_code, phone, email, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
         RETURNING ${BRANCH_COLUMNS}`,
        [
          companyId,
          dto.name,
          dto.code ?? null,
          dto.addressLine1 ?? null,
          dto.addressLine2 ?? null,
          dto.city ?? null,
          dto.county ?? null,
          dto.postalCode ?? null,
          dto.phone ?? null,
          dto.email ?? null,
        ],
      );
      return result.rows[0];
    });

    await this.audit.log({
      userId: user.userId,
      companyId,
      branchId: branch.id,
      action: 'branch.create',
      entityType: 'branch',
      entityId: branch.id,
      oldValues: null,
      newValues: { name: dto.name, code: dto.code ?? null },
      ipAddress: null,
    });

    return branch;
  }

  async update(
    user: AuthenticatedUser,
    companyId: string,
    branchId: string,
    dto: UpdateBranchDto,
  ): Promise<BranchRow> {
    const membership = await this.memberships.requireRole(user.userId, companyId, ['owner', 'admin', 'manager']);

    // Branch-bound managers may administer only their assigned branch. Company-wide
    // owners/admins remain unrestricted; a missing branch assignment is company-wide
    // only when the membership is not branch-bound by its authoritative record.
    if (
      membership.branchId &&
      !['owner', 'admin'].includes(membership.role) &&
      membership.branchId !== branchId
    ) {
      throw new ForbiddenException('You can only update your assigned branch.');
    }

    const existing = await this.getByIdInternal(companyId, branchId);

    const fields: string[] = [];
    const values: (string | boolean | null)[] = [];
    let paramIndex = 1;

    const fieldMap: Record<string, string> = {
      name: 'name',
      code: 'code',
      addressLine1: 'address_line1',
      addressLine2: 'address_line2',
      city: 'city',
      county: 'county',
      postalCode: 'postal_code',
      phone: 'phone',
      email: 'email',
      isActive: 'is_active',
    };

    for (const [dtoKey, dbColumn] of Object.entries(fieldMap)) {
      if (dtoKey in dto) {
        const value = (dto as Record<string, unknown>)[dtoKey];
        fields.push(`${dbColumn} = $${paramIndex}`);
        values.push(value as string | boolean | null);
        paramIndex++;
      }
    }

    if (fields.length === 0) {
      return existing;
    }

    fields.push('updated_at = NOW()');
    values.push(branchId);
    values.push(companyId);

    const result = await this.db.query<BranchRow>(
      `UPDATE branches SET ${fields.join(', ')}
       WHERE id = $${paramIndex} AND company_id = $${paramIndex + 1}
       RETURNING ${BRANCH_COLUMNS}`,
      values,
    );

    if (result.rows.length === 0) {
      throw new NotFoundException('Branch not found for this company.');
    }

    const updated = result.rows[0];

    await this.audit.log({
      userId: user.userId,
      companyId,
      branchId: updated.id,
      action: 'branch.update',
      entityType: 'branch',
      entityId: updated.id,
      oldValues: { name: existing.name },
      newValues: { name: updated.name },
      ipAddress: null,
    });

    return updated;
  }

  private async getByIdInternal(companyId: string, branchId: string): Promise<BranchRow> {
    const result = await this.db.query<BranchRow>(
      `SELECT ${BRANCH_COLUMNS} FROM branches WHERE id = $1 AND company_id = $2`,
      [branchId, companyId],
    );

    if (result.rows.length === 0) {
      throw new NotFoundException('Branch not found for this company.');
    }

    return result.rows[0];
  }
}
