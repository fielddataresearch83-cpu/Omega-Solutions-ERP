import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from './audit.service.js';
import type { DatabaseService } from '../database.service.js';

describe('AuditService', () => {
  const db = { query: vi.fn() };
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
