import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CompaniesService } from './companies.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import type { CompanyRow } from './company.types.js';

type Mock = ReturnType<typeof vi.fn>;

const USER_A: AuthenticatedUser = {
  userId: 'user-a',
  email: 'a@omega.test',
  fullName: 'User A',
  companyId: 'comp-a',
  branchId: null,
  role: 'owner',
  permissions: ['companies:read', 'companies:write'],
};

const COMPANY_A: CompanyRow = {
  id: 'comp-a',
  name: 'Alpha Ltd',
  registration_number: null,
  vat_number: null,
  currency: 'KES',
  timezone: 'Africa/Nairobi',
  address_line1: null,
  address_line2: null,
  city: null,
  county: null,
  postal_code: null,
  phone: null,
  email: null,
  website: null,
  settings: {},
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

describe('CompaniesService', () => {
  let service: CompaniesService;
  let db: { query: Mock };
  let memberships: {
    getMembership: Mock;
    getMembershipForCompany: Mock;
    requireOwnerOrAdmin: Mock;
    requireRole: Mock;
  };
  let audit: { log: Mock };

  beforeEach(async () => {
    db = { query: vi.fn() };
    memberships = {
      getMembership: vi.fn(),
      getMembershipForCompany: vi.fn(),
      requireOwnerOrAdmin: vi.fn(),
      requireRole: vi.fn(),
    };
    audit = { log: vi.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompaniesService,
        { provide: DatabaseService, useValue: db },
        { provide: MembershipsService, useValue: memberships },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get(CompaniesService);
  });

  describe('getMyCompany', () => {
    it('returns the selected company for the authenticated user via company-scoped membership', async () => {
      memberships.getMembershipForCompany.mockResolvedValue({ companyId: 'comp-a', branchId: null, role: 'owner' });
      db.query.mockResolvedValue({ rows: [COMPANY_A], rowCount: 1 });

      const result = await service.getMyCompany(USER_A);

      expect(result.id).toBe('comp-a');
      expect(memberships.getMembershipForCompany).toHaveBeenCalledWith('user-a', 'comp-a');
      expect(memberships.getMembership).not.toHaveBeenCalled();
    });
  });

  describe('getForUser (tenant isolation)', () => {
    it('returns company when user has membership for that company', async () => {
      memberships.getMembershipForCompany.mockResolvedValue({ companyId: 'comp-a', branchId: null, role: 'owner' });
      db.query.mockResolvedValue({ rows: [COMPANY_A], rowCount: 1 });

      const result = await service.getForUser(USER_A, 'comp-a');

      expect(result.id).toBe('comp-a');
      expect(memberships.getMembershipForCompany).toHaveBeenCalledWith('user-a', 'comp-a');
    });

    it('throws ForbiddenException when user tries to access another company', async () => {
      memberships.getMembershipForCompany.mockRejectedValue(
        new ForbiddenException('You do not have access to this company.'),
      );

      await expect(
        service.getForUser(USER_A, 'comp-b'),
      ).rejects.toThrow(ForbiddenException);

      expect(memberships.getMembershipForCompany).toHaveBeenCalledWith('user-a', 'comp-b');
    });
  });

  describe('update (tenant isolation)', () => {
    it('throws ForbiddenException when user tries to update another company', async () => {
      memberships.requireOwnerOrAdmin.mockRejectedValue(
        new ForbiddenException('You do not have access to this company.'),
      );

      await expect(
        service.update(USER_A, 'comp-b', { name: 'Hacked' }),
      ).rejects.toThrow(ForbiddenException);

      expect(memberships.requireOwnerOrAdmin).toHaveBeenCalledWith('user-a', 'comp-b');
    });

    it('updates company when user is owner/admin of that company', async () => {
      memberships.requireOwnerOrAdmin.mockResolvedValue({ companyId: 'comp-a', branchId: null, role: 'owner' });
      db.query
        .mockResolvedValueOnce({ rows: [COMPANY_A], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ ...COMPANY_A, name: 'Alpha Updated' }], rowCount: 1 });

      const result = await service.update(USER_A, 'comp-a', { name: 'Alpha Updated' });

      expect(result.name).toBe('Alpha Updated');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'company.update', entityId: 'comp-a' }),
      );
    });
  });

  it('persists tax policy in company settings using a bound JSON parameter', async () => {
    memberships.requireOwnerOrAdmin.mockResolvedValue({ companyId: 'comp-a', branchId: null, role: 'owner' });
    const policy = { mode: 'configured' as const, vatRegistered: true, standardRate: 16 };
    db.query
      .mockResolvedValueOnce({ rows: [COMPANY_A], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ ...COMPANY_A, settings: { taxPolicy: policy } }], rowCount: 1 });

    const result = await service.update(USER_A, 'comp-a', { taxPolicy: policy });

    expect(result.settings).toEqual({ taxPolicy: policy });
    expect(db.query.mock.calls[1][0]).toContain("'{taxPolicy}', $1::jsonb");
    expect(db.query.mock.calls[1][1]).toEqual([JSON.stringify(policy), 'comp-a']);
  });

  describe('getById', () => {
    it('throws NotFoundException for non-existent company', async () => {
      db.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await expect(service.getById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
