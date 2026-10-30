import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from './audit.service.js';
import type { DatabaseService } from '../database.service.js';

describe('AuditService', () => {
  const db = { query: vi.fn() };
  const client = { query: vi.fn() };
  let service: AuditService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AuditService(db as unknown as DatabaseService);
  });

  it('limits audit reads to the requested company', async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await service.list('company-a', 500);
    expect(db.query.mock.calls[0][0]).toContain('WHERE al.company_id = $1');
    expect(db.query.mock.calls[0][0]).toContain('al.branch_id = $3::uuid');
    expect(db.query.mock.calls[0][1]).toEqual(['company-a', 200, null]);
  });

  it('passes the assigned branch when listing audit history', async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await service.list('company-a', 100, 'branch-a');
    expect(db.query.mock.calls[0][0]).toContain('al.branch_id = $3::uuid');
    expect(db.query.mock.calls[0][1]).toEqual(['company-a', 100, 'branch-a']);
  });

  it('uses the supplied transaction client for audit inserts', async () => {
    client.query.mockResolvedValue({ rows: [], rowCount: 1 });
    await service.logInTransaction(client as never, { userId: 'user-a', companyId: 'company-a', branchId: null, action: 'test.event', entityType: 'test', entityId: 'item-a', oldValues: null, newValues: { ok: true }, ipAddress: null });
    expect(client.query).toHaveBeenCalledOnce();
    expect(client.query.mock.calls[0][0]).toContain('INSERT INTO audit_logs');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('propagates failures from transaction-scoped audit inserts', async () => {
    const failure = new Error('audit insert failed');
    client.query.mockRejectedValue(failure);
    await expect(service.logInTransaction(client as never, {
      userId: 'user-a', companyId: 'company-a', branchId: null,
      action: 'invoice.payment.confirm', entityType: 'invoice_payment', entityId: 'payment-a',
      oldValues: { status: 'pending' }, newValues: { status: 'confirmed' }, ipAddress: null,
    })).rejects.toBe(failure);
  });

  it('surfaces audit persistence failures instead of silently swallowing them', async () => {
    const failure = new Error('database unavailable');
    db.query.mockRejectedValue(failure);
    await expect(service.log({
      userId: 'user-a', companyId: 'company-a', branchId: null,
      action: 'UPDATE', entityType: 'customer', entityId: 'customer-a',
      oldValues: null, newValues: { name: 'Acme' }, ipAddress: null,
    })).rejects.toBe(failure);
  });
});
