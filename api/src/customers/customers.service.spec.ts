import { CustomersService } from './customers.service.js';

describe('CustomersService branch balance privacy', () => {
  const user = { userId: 'user-1', companyId: 'company-1' } as any;
  const customer = {
    id: 'customer-1', company_id: 'company-1', name: 'Customer One',
    email: null, phone: null, city: null, county: null, address_line1: null,
    postal_code: null, credit_limit: 1000, outstanding_balance: 425,
    status: 'active', is_active: true, created_at: '2026-01-01', updated_at: '2026-01-01',
  };
  let db: { query: ReturnType<typeof vi.fn> };
  let memberships: { getMembership: ReturnType<typeof vi.fn>; getMembershipForCompany: ReturnType<typeof vi.fn> };
  let service: CustomersService;

  beforeEach(() => {
    db = { query: vi.fn().mockResolvedValue({ rows: [customer], rowCount: 1 }) };
    memberships = {
      getMembership: vi.fn(),
      getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: 'branch-1' }),
    };
    service = new CustomersService(db as any, memberships as any, { log: vi.fn() } as any);
  });

  it('redacts the company-wide outstanding balance from branch customer lists', async () => {
    const rows = await service.list(user);
    expect(rows[0].outstanding_balance).toBeNull();
    expect(rows[0].name).toBe('Customer One');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE company_id = $1 ORDER BY created_at DESC'), ['company-1']);
  });

  it('redacts the company-wide outstanding balance from branch customer detail', async () => {
    const result = await service.getById(user, 'customer-1');
    expect(result.outstanding_balance).toBeNull();
    expect(result.name).toBe('Customer One');
  });

  it('retains the outstanding balance for company-wide members', async () => {
    memberships.getMembershipForCompany.mockResolvedValue({ companyId: 'company-1', branchId: null });
    const rows = await service.list(user);
    expect(rows[0].outstanding_balance).toBe(425);
  });
});
