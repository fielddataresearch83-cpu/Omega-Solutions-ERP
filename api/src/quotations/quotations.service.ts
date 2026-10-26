import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import type { CreateQuotationDto } from './dto/quotation.dto.js';
import type { QuotationItemRow, QuotationRow, QuotationStatus } from './quotation.types.js';

const SELECT_QUOTATIONS = `
  SELECT q.id, q.company_id, q.customer_id, c.name AS customer_name,
         q.quotation_number, q.issue_date, q.valid_until, q.status, q.currency,
         q.subtotal, q.tax_amount, q.total, q.notes, q.created_at, q.updated_at,
         COUNT(qi.id)::int AS item_count
  FROM quotations q
  JOIN customers c ON c.id = q.customer_id AND c.company_id = q.company_id
  LEFT JOIN quotation_items qi ON qi.quotation_id = q.id AND qi.company_id = q.company_id
`;

@Injectable()
export class QuotationsService {
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

  private assertCompanyWideAccess(membership: { branchId?: string | null }): void {
    if (membership.branchId) {
      throw new ForbiddenException('Quotations are company-wide records and can only be accessed by company-wide members.');
    }
  }

  async list(user: AuthenticatedUser, search?: string, status?: string): Promise<QuotationRow[]> {
    const membership = await this.membershipFor(user);
    this.assertCompanyWideAccess(membership);
    const conditions = ['q.company_id = $1'];
    const params: (string | number)[] = [membership.companyId];
    if (search?.trim()) {
      params.push(`%${search.trim()}%`);
      conditions.push(`(q.quotation_number ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
    }
    if (status && status !== 'all') {
      if (!this.isStatus(status)) throw new BadRequestException('Invalid quotation status.');
      params.push(status);
      conditions.push(`q.status = $${params.length}`);
    }
    const result = await this.db.query<QuotationRow>(
      `${SELECT_QUOTATIONS} WHERE ${conditions.join(' AND ')}
       GROUP BY q.id, c.name ORDER BY q.created_at DESC`,
      params,
    );
    return result.rows;
  }

  async getById(user: AuthenticatedUser, id: string): Promise<QuotationRow> {
    const membership = await this.membershipFor(user);
    this.assertCompanyWideAccess(membership);
    const result = await this.db.query<QuotationRow>(
      `${SELECT_QUOTATIONS} WHERE q.company_id = $1 AND q.id = $2 GROUP BY q.id, c.name`,
      [membership.companyId, id],
    );
    const quotation = result.rows[0];
    if (!quotation) throw new NotFoundException('Quotation not found.');
    const items = await this.db.query<QuotationItemRow>(
      `SELECT id, quotation_id, product_id, product_name, sku, quantity, unit_price,
              tax_rate, line_subtotal, tax_amount, line_total
       FROM quotation_items WHERE company_id = $1 AND quotation_id = $2 ORDER BY created_at`,
      [membership.companyId, id],
    );
    quotation.items = items.rows;
    return quotation;
  }

  async create(user: AuthenticatedUser, dto: CreateQuotationDto): Promise<QuotationRow> {
    const membership = await this.membershipFor(user);
    this.assertCompanyWideAccess(membership);
    if (dto.validUntil < dto.issueDate) throw new BadRequestException('Valid-until date cannot be before issue date.');

    const created = await this.db.transaction(async (client) => {
      const customer = await client.query<{ id: string }>(
        'SELECT id FROM customers WHERE id = $1 AND company_id = $2 AND is_active = TRUE FOR SHARE',
        [dto.customerId, membership.companyId],
      );
      if (!customer.rows[0]) throw new BadRequestException('Choose an active customer from your company.');

      const year = Number(dto.issueDate.slice(0, 4));
      const seq = await client.query<{ next_number: number }>(
        `INSERT INTO quotation_sequences (company_id, quotation_year, next_number)
         VALUES ($1, $2, 1)
         ON CONFLICT (company_id, quotation_year)
         DO UPDATE SET next_number = quotation_sequences.next_number + 1
         RETURNING next_number`,
        [membership.companyId, year],
      );
      const number = `QUO-${year}-${String(seq.rows[0].next_number).padStart(5, '0')}`;
      const resolved: Array<{ productId: string; name: string; sku: string | null; quantity: number; priceCents: number; taxRate: number; subtotalCents: number; taxCents: number }> = [];
      let subtotalCents = 0;
      let taxCents = 0;

      for (const item of dto.items) {
        const productResult = await client.query<{ id: string; name: string; sku: string | null; selling_price: string | number; is_active: boolean }>(
          'SELECT id, name, sku, selling_price, is_active, tax_treatment, tax_rate FROM products WHERE id = $1 AND company_id = $2 FOR SHARE',
          [item.productId, membership.companyId],
        );
        const product = productResult.rows[0];
        if (!product || !product.is_active) throw new BadRequestException('Each quotation item must be an active product from your company.');
        const priceCents = Math.round(Number(item.unitPrice ?? product.selling_price) * 100);
        const quantityMilli = Math.round(item.quantity * 1000);
        const quantity = quantityMilli / 1000;
        const lineSubtotalCents = Math.round(priceCents * quantityMilli / 1000);
        const taxRate = product.tax_treatment === 'legacy'
          ? (item.taxRate ?? 0)
          : product.tax_treatment === 'standard'
            ? Number(product.tax_rate)
            : 0;
        const lineTaxCents = Math.round(lineSubtotalCents * taxRate / 100);
        subtotalCents += lineSubtotalCents;
        taxCents += lineTaxCents;
        resolved.push({ productId: product.id, name: product.name, sku: product.sku, quantity, priceCents, taxRate, subtotalCents: lineSubtotalCents, taxCents: lineTaxCents });
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO quotations (company_id, customer_id, quotation_number, issue_date, valid_until, status, subtotal, tax_amount, total, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10) RETURNING id`,
        [membership.companyId, dto.customerId, number, dto.issueDate, dto.validUntil, subtotalCents / 100, taxCents / 100, (subtotalCents + taxCents) / 100, dto.notes ?? null, user.userId],
      );
      for (const item of resolved) {
        await client.query(
          `INSERT INTO quotation_items (company_id, quotation_id, product_id, product_name, sku, quantity, unit_price, tax_rate, line_subtotal, tax_amount, line_total)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [membership.companyId, inserted.rows[0].id, item.productId, item.name, item.sku, item.quantity, item.priceCents / 100, item.taxRate, item.subtotalCents / 100, item.taxCents / 100, (item.subtotalCents + item.taxCents) / 100],
        );
      }
      return { id: inserted.rows[0].id, number };
    });

    await this.audit.log({
      userId: user.userId, companyId: membership.companyId, branchId: null,
      action: 'quotation.create', entityType: 'quotation', entityId: created.id,
      oldValues: null, newValues: { quotationNumber: created.number, customerId: dto.customerId }, ipAddress: null,
    });
    return this.getById(user, created.id);
  }

  async updateStatus(user: AuthenticatedUser, id: string, nextStatus: string): Promise<QuotationRow> {
    const membership = await this.membershipFor(user);
    this.assertCompanyWideAccess(membership);
    const allowed: Record<QuotationStatus, QuotationStatus[]> = {
      draft: ['sent', 'cancelled'], sent: ['accepted', 'rejected', 'expired', 'cancelled'],
      accepted: ['cancelled'], rejected: [], expired: [], cancelled: [], converted: [],
    };
    const from = await this.db.transaction(async (client) => {
      const current = await client.query<{ id: string; company_id: string; status: string }>(
        'SELECT id, company_id, status FROM quotations WHERE id = $1 AND company_id = $2 FOR UPDATE',
        [id, membership.companyId],
      );
      const quotation = current.rows[0];
      if (!quotation) throw new NotFoundException('Quotation not found.');
      const currentStatus = quotation.status as QuotationStatus;
      if (!this.isStatus(nextStatus) || !allowed[currentStatus]?.includes(nextStatus as QuotationStatus)) {
        throw new BadRequestException(`Cannot change quotation status from ${currentStatus} to ${nextStatus}.`);
      }
      await client.query(
        'UPDATE quotations SET status = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3',
        [nextStatus, id, membership.companyId],
      );
      return currentStatus;
    });
    await this.audit.log({
      userId: user.userId, companyId: membership.companyId, branchId: null,
      action: 'quotation.status.update', entityType: 'quotation', entityId: id,
      oldValues: { status: from }, newValues: { status: nextStatus }, ipAddress: null,
    });
    return this.getById(user, id);
  }

  private isStatus(value: string): value is QuotationStatus {
    return ['draft', 'sent', 'accepted', 'rejected', 'expired', 'cancelled', 'converted'].includes(value);
  }
}
