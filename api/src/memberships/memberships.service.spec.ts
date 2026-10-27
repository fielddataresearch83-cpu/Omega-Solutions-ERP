import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from './memberships.service.js';

type Mock = ReturnType<typeof vi.fn>;

describe('MembershipsService', () => {
  let service: MembershipsService;
  let db: { query: Mock };

  beforeEach(async () => {
    db = { query: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipsService,
        { provide: DatabaseService, useValue: db },
      ],
    }).compile();

    service = module.get(MembershipsService);
  });

  describe('getMembership', () => {
    it('returns the only active company membership for a user', async () => {
      db.query.mockResolvedValue({
        rows: [{ company_id: 'comp-1', branch_id: null, role: 'owner' }],
        rowCount: 1,
      });

      const result = await service.getMembership('user-1');

      expect(result).toEqual({ companyId: 'comp-1', branchId: null, role: 'owner' });
    });

    it('throws when multiple active company memberships require explicit selection', async () => {
      db.query.mockResolvedValue({
        rows: [
          { company_id: 'comp-1', branch_id: null, role: 'owner' },
          { company_id: 'comp-2', branch_id: null, role: 'admin' },
        ],
        rowCount: 2,
      });

      await expect(service.getMembership('user-1')).rejects.toThrow(
        'Company selection is required for accounts with multiple active company memberships.',
      );
      expect(db.query.mock.calls[0][0]).toContain('JOIN companies c ON c.id = cm.company_id AND c.is_active = true');
      expect(db.query.mock.calls[0][0]).toContain('LIMIT 2');
    });

    it('throws ForbiddenException when user has no memberships', async () => {
      db.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await expect(service.getMembership('user-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getMembershipForCompany', () => {
    it('returns membership when user belongs to the requested company', async () => {
      db.query.mockResolvedValue({
        rows: [{ company_id: 'comp-1', branch_id: 'br-1', role: 'admin' }],
        rowCount: 1,
      });

      const result = await service.getMembershipForCompany('user-1', 'comp-1');

      expect(result).toEqual({ companyId: 'comp-1', branchId: 'br-1', role: 'admin' });
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('cm.user_id = $1 AND cm.company_id = $2 AND cm.is_active = true'),
        ['user-1', 'comp-1'],
      );
      expect(db.query.mock.calls[0][0]).toContain('JOIN companies c ON c.id = cm.company_id AND c.is_active = true');
    });

    it('throws ForbiddenException when user does not belong to the company or the company is inactive', async () => {
      db.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await expect(
        service.getMembershipForCompany('user-1', 'comp-other'),
      ).rejects.toThrow(ForbiddenException);
      expect(db.query.mock.calls[0][0]).toContain('JOIN companies c ON c.id = cm.company_id AND c.is_active = true');
    });
  });

  describe('requireRole', () => {
    it('returns membership when user role is in the allowed list', async () => {
      db.query.mockResolvedValue({
        rows: [{ company_id: 'comp-1', branch_id: null, role: 'manager' }],
        rowCount: 1,
      });

      const result = await service.requireRole('user-1', 'comp-1', ['owner', 'admin', 'manager']);

      expect(result.role).toBe('manager');
    });

    it('throws ForbiddenException when user role is not allowed', async () => {
      db.query.mockResolvedValue({
        rows: [{ company_id: 'comp-1', branch_id: null, role: 'viewer' }],
        rowCount: 1,
      });

      await expect(
        service.requireRole('user-1', 'comp-1', ['owner', 'admin']),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('requireOwnerOrAdmin', () => {
    it('passes for owner', async () => {
      db.query.mockResolvedValue({
        rows: [{ company_id: 'comp-1', branch_id: null, role: 'owner' }],
        rowCount: 1,
      });

      const result = await service.requireOwnerOrAdmin('user-1', 'comp-1');
      expect(result.role).toBe('owner');
    });

    it('rejects staff', async () => {
      db.query.mockResolvedValue({
        rows: [{ company_id: 'comp-1', branch_id: null, role: 'staff' }],
        rowCount: 1,
      });

      await expect(
        service.requireOwnerOrAdmin('user-1', 'comp-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
