import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import { BranchesService } from './branches.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import type { BranchRow } from './branch.types.js';

type Mock = ReturnType<typeof vi.fn>;

const USER_A: AuthenticatedUser = {
  userId: 'user-a',
  email: 'a@omega.test',
  fullName: 'User A',
  companyId: 'comp-a',
  branchId: null,
  role: 'owner',
  permissions: ['branches:read', 'branches:write'],
};

const BRANCH_A: BranchRow = {
  id: 'br-a',
  company_id: 'comp-a',
  name: 'Main Branch',
  code: 'MAIN',
  address_line1: null,
  address_line2: null,
  city: null,
  county: null,
  postal_code: null,
  phone: null,
  email: null,
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

describe('BranchesService', () => {
  let service: BranchesService;
  let db: { query: Mock; transaction: Mock };
  let subscriptions: { assertBranchCapacity: Mock };
  let memberships: {
    getMembershipForCompany: Mock;
    requireRole: Mock;
    requireOwnerOrAdmin: Mock;
    getMembership: Mock;
  };
  let audit: { log: Mock };

  beforeEach(async () => {
    db = { query: vi.fn(), transaction: vi.fn(async (callback: (client: any) => Promise<unknown>) => callback({ query: db.query })) };
    subscriptions = { assertBranchCapacity: vi.fn().mockResolvedValue(undefined) };
    memberships = {
      getMembershipForCompany: vi.fn(),
      requireRole: vi.fn(),
      requireOwnerOrAdmin: vi.fn(),
      getMembership: vi.fn(),
    };
    audit = { log: vi.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BranchesService,
        { provide: DatabaseService, useValue: db },
        { provide: MembershipsService, useValue: memberships },
        { provide: AuditService, useValue: audit },
        { provide: SubscriptionsService, useValue: subscriptions },
      ],
    }).compile();

    service = module.get(BranchesService);
  });

  describe('listByCompany (tenant isolation)', () => {
    it('lists branches for a company the user belongs to', async () => {
      memberships.getMembershipForCompany.mockResolvedValue({ companyId: 'comp-a', branchId: null, role: 'owner' });
      db.query.mockResolvedValue({ rows: [BRANCH_A], rowCount: 1 });

      const result = await service.listByCompany(USER_A, 'comp-a');

      expect(result).toHaveLength(1);
      expect(result[0].company_id).toBe('comp-a');
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE company_id = $1'),
        ['comp-a'],
      );
    });

    it('throws ForbiddenException when user tries to list branches of another company', async () => {
      memberships.getMembershipForCompany.mockRejectedValue(
        new ForbiddenException('You do not have access to this company.'),
      );

      await expect(
        service.listByCompany(USER_A, 'comp-b'),
      ).rejects.toThrow(ForbiddenException);

      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('getById (tenant isolation)', () => {
    it('returns branch when user belongs to the company', async () => {
      memberships.getMembershipForCompany.mockResolvedValue({ companyId: 'comp-a', branchId: null, role: 'owner' });
      db.query.mockResolvedValue({ rows: [BRANCH_A], rowCount: 1 });

      const result = await service.getById(USER_A, 'comp-a', 'br-a');

      expect(result.id).toBe('br-a');
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1 AND company_id = $2'),
        ['br-a', 'comp-a'],
      );
    });

    it('throws ForbiddenException when user tries to access a branch of another company', async () => {
      memberships.getMembershipForCompany.mockRejectedValue(
        new ForbiddenException('You do not have access to this company.'),
      );

      await expect(
        service.getById(USER_A, 'comp-b', 'br-a'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when branch exists but belongs to a different company', async () => {
      memberships.getMembershipForCompany.mockResolvedValue({ companyId: 'comp-a', branchId: null, role: 'owner' });
      db.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await expect(
        service.getById(USER_A, 'comp-a', 'br-from-other-company'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('create (tenant isolation)', () => {
    it('throws ForbiddenException when user tries to create a branch in another company', async () => {
      memberships.requireRole.mockRejectedValue(
        new ForbiddenException('You do not have access to this company.'),
      );

      await expect(
        service.create(USER_A, 'comp-b', { name: 'New Branch' }),
      ).rejects.toThrow(ForbiddenException);

      expect(memberships.requireRole).toHaveBeenCalledWith('user-a', 'comp-b', ['owner', 'admin', 'manager']);
    });

    it('does not create or audit a branch when subscription capacity is exhausted', async () => {
      memberships.requireRole.mockResolvedValue({ companyId: 'comp-a', branchId: null, role: 'owner' });
      subscriptions.assertBranchCapacity.mockRejectedValue(new ForbiddenException('Branch limit reached.'));

      await expect(service.create(USER_A, 'comp-a', { name: 'Extra Branch' })).rejects.toThrow(ForbiddenException);

      expect(db.query).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('creates branch in the company the user belongs to', async () => {
      memberships.requireRole.mockResolvedValue({ companyId: 'comp-a', branchId: null, role: 'owner' });
      db.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [BRANCH_A], rowCount: 1 });

      const result = await service.create(USER_A, 'comp-a', { name: 'Main Branch', code: 'MAIN' });

      expect(result.id).toBe('br-a');
      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(subscriptions.assertBranchCapacity).toHaveBeenCalledWith('comp-a', expect.objectContaining({ query: db.query }));
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'branch.create', companyId: 'comp-a' }),
      );
    });
  });

  describe('update (tenant isolation)', () => {
    it('blocks a branch-bound manager from updating a different branch in the same company', async () => {
      const manager: AuthenticatedUser = {
        ...USER_A,
        role: 'manager',
        branchId: 'br-assigned',
      };
      memberships.requireRole.mockResolvedValue({ companyId: 'comp-a', branchId: 'br-assigned', role: 'manager' });

      await expect(
        service.update(manager, 'comp-a', 'br-other', { name: 'Out of scope' }),
      ).rejects.toThrow(ForbiddenException);

      expect(db.query).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('allows a branch-bound manager to update their assigned branch', async () => {
      const manager: AuthenticatedUser = {
        ...USER_A,
        role: 'manager',
        branchId: 'br-a',
      };
      memberships.requireRole.mockResolvedValue({ companyId: 'comp-a', branchId: 'br-a', role: 'manager' });
      db.query
        .mockResolvedValueOnce({ rows: [BRANCH_A], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ ...BRANCH_A, name: 'Assigned branch updated' }], rowCount: 1 });

      const result = await service.update(manager, 'comp-a', 'br-a', { name: 'Assigned branch updated' });

      expect(result.name).toBe('Assigned branch updated');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'branch.update', branchId: 'br-a' }));
    });

    it('throws ForbiddenException when user tries to update a branch in another company', async () => {
      memberships.requireRole.mockRejectedValue(
        new ForbiddenException('You do not have access to this company.'),
      );

      await expect(
        service.update(USER_A, 'comp-b', 'br-x', { name: 'Hacked' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('includes company_id in WHERE clause to prevent cross-tenant update', async () => {
      memberships.requireRole.mockResolvedValue({ companyId: 'comp-a', branchId: null, role: 'owner' });
      db.query
        .mockResolvedValueOnce({ rows: [BRANCH_A], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ ...BRANCH_A, name: 'Updated' }], rowCount: 1 });

      await service.update(USER_A, 'comp-a', 'br-a', { name: 'Updated' });

      const updateCall = db.query.mock.calls[1];
      expect(updateCall[0]).toContain('WHERE id = $');
      expect(updateCall[0]).toContain('AND company_id = $');
    });
  });
});
