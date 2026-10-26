import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchService } from './search.service.js';
import type { DatabaseService } from '../database.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

const user = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  userId: 'user-a',
  email: 'a@example.test',
  fullName: 'User A',
  companyId: 'company-a',
  branchId: null,
  role: 'staff',
  permissions: ['customers:read'],
  ...overrides,
});

describe('SearchService', () => {
  const db = { query: vi.fn() };
  let service: SearchService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SearchService(db as unknown as DatabaseService);
  });

  it('does not query the database without a company or search term', async () => {
    expect(await service.search(user({ companyId: null }), 'Acme')).toEqual([]);
    expect(await service.search(user(), '  ')).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('searches only modules the user can read and scopes SQL to the active company', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'customer-a', title: 'Acme', type: 'Customer' }], rowCount: 1 });
    const results = await service.search(user(), 'Acme');

    expect(results).toHaveLength(1);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toContain('WHERE company_id=$1');
    expect(db.query.mock.calls[0][1]).toEqual(['company-a', '%Acme%']);
  });

  it('returns no records for a user without read permissions', async () => {
    expect(await service.search(user({ permissions: [] }), 'Acme')).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('searches invoice records only for users with sales:read and scopes them to company', async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await service.search(user({ permissions: ['sales:read'] }), 'INV-1');
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toContain('i.company_id=$1');
    expect(db.query.mock.calls[0][1]?.[0]).toBe('company-a');
  });


  it('restricts employee search to the active branch when membership is branch-bound', async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await service.search(user({ branchId: 'branch-a', permissions: ['employees:read'] }), 'Amina');
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toContain('($3::uuid IS NULL OR branch_id=$3)');
    expect(db.query.mock.calls[0][1]).toEqual(['company-a', '%Amina%', 'branch-a']);
  });

  it('ranks exact title matches before partial matches across permitted modules', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'customer-1', title: 'Acme Holdings', type: 'Customer', subtitle: 'hello@example.test' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'product-1', title: 'Acme', type: 'Product', subtitle: 'AC-01' }], rowCount: 1 });
    const results = await service.search(user({ permissions: ['customers:read', 'products:read'] }), 'Acme');

    expect(results.map(row => row.id)).toEqual(['product-1', 'customer-1']);
    expect(db.query).toHaveBeenCalledTimes(2);
    for (const call of db.query.mock.calls) {
      expect(call[1]?.[0]).toBe('company-a');
    }
  });
});
