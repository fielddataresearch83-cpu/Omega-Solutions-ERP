import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import { UsersRolesService } from './users-roles.service.js';

type Mock = ReturnType<typeof vi.fn>;

describe('UsersRolesService', () => {
  let service: UsersRolesService;
  let db: { query: Mock; transaction: Mock };
  let client: { query: Mock };
  let memberships: { getMembership: Mock; getMembershipForCompany: Mock; requireOwnerOrAdmin: Mock };
  let audit: { log: Mock };
  const owner = { userId: 'owner-1', companyId: 'company-1', branchId: null } as any;

  beforeEach(async () => {
    client = { query: vi.fn() };
    db = {
      query: vi.fn(),
      transaction: vi.fn((callback: (client: { query: Mock }) => Promise<unknown>) => callback(client)),
    };
    memberships = {
      getMembership: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null, role: 'owner' }),
      getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null, role: 'owner' }),
      requireOwnerOrAdmin: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null, role: 'owner' }),
    };
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersRolesService,
        { provide: DatabaseService, useValue: db },
        { provide: MembershipsService, useValue: memberships },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = module.get(UsersRolesService);
  });

  it('lists memberships only within the active company', async () => {
    db.query.mockResolvedValue({ rows: [{ membership_id: 'membership-1', company_id: 'company-1' }], rowCount: 1 });

    const result = await service.list(owner);

    expect(result).toHaveLength(1);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE m.company_id = $1'), ['company-1', null, 'owner']);
    expect(db.query.mock.calls[0][0]).toContain('JOIN users u ON u.id = m.user_id');
  });

  it('limits a branch-bound manager to their branch and company-wide memberships', async () => {
    const manager = { userId: 'manager-1', companyId: 'company-1', branchId: 'branch-1' } as any;
    memberships.getMembershipForCompany.mockResolvedValue({
      companyId: 'company-1', branchId: 'branch-1', role: 'manager',
    });
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await service.list(manager);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('m.branch_id = $2::uuid'),
      ['company-1', 'branch-1', 'manager'],
    );
    expect(db.query.mock.calls[0][0]).toContain('OR m.branch_id IS NULL');
  });

  it('requires owner or admin before returning the role catalog', async () => {
    db.query.mockResolvedValue({ rows: [{ role: 'manager', permissions: ['users:read'] }], rowCount: 1 });

    await service.roleCatalog(owner);

    expect(memberships.requireOwnerOrAdmin).toHaveBeenCalledWith('owner-1', 'company-1');
    expect(db.query.mock.calls[0][0]).toContain('role_permissions');
  });

  it('does not allow an admin to grant another user the admin role', async () => {
    memberships.requireOwnerOrAdmin.mockResolvedValue({ companyId: 'company-1', branchId: null, role: 'admin' });

    await expect(service.updateRole(owner, 'membership-2', { role: 'admin' } as any)).rejects.toThrow(ForbiddenException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('does not allow a user to change their own role', async () => {
    client.query.mockResolvedValueOnce({
      rows: [{ id: 'membership-1', user_id: owner.userId, role: 'owner', is_active: true }],
      rowCount: 1,
    });

    await expect(service.updateRole(owner, 'membership-1', { role: 'manager' } as any)).rejects.toThrow(BadRequestException);
    expect(client.query.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE company_memberships'))).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('refuses ordinary role edits to an owner membership', async () => {
    client.query.mockResolvedValueOnce({
      rows: [{ id: 'membership-2', user_id: 'user-2', role: 'owner', is_active: true }],
      rowCount: 1,
    });

    await expect(service.updateRole(owner, 'membership-2', { role: 'manager' } as any)).rejects.toThrow(ForbiddenException);
    expect(client.query.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE company_memberships'))).toBe(false);
  });

  it('updates a company-scoped membership and records the role change in audit history', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [{ id: 'membership-2', user_id: 'user-2', role: 'staff', is_active: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'membership-2', user_id: 'user-2', role: 'manager', is_active: true }], rowCount: 1 });

    const result = await service.updateRole(owner, 'membership-2', { role: 'manager' } as any);

    expect(result.role).toBe('manager');
    expect(client.query.mock.calls[0][0]).toContain('WHERE company_id=$1 AND id=$2 FOR UPDATE');
    expect(client.query.mock.calls[0][1]).toEqual(['company-1', 'membership-2']);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-1',
      action: 'update_role',
      entityType: 'company_membership',
      entityId: 'membership-2',
      oldValues: { role: 'staff' },
      newValues: { role: 'manager' },
    }));
  });

  it('returns not found when the membership is not in the active company', async () => {
    client.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(service.updateRole(owner, 'foreign-membership', { role: 'manager' } as any)).rejects.toThrow(NotFoundException);
    expect(client.query.mock.calls[0][1]).toEqual(['company-1', 'foreign-membership']);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('blocks self-role-change via the transaction-level user_id check even when the membership id matches the actor', async () => {
    memberships.requireOwnerOrAdmin.mockResolvedValue({ companyId: 'company-1', branchId: null, role: 'admin' });
    const admin = { userId: 'admin-1', companyId: 'company-1', branchId: null } as any;
    client.query.mockResolvedValueOnce({
      rows: [{ id: 'membership-admin', user_id: admin.userId, role: 'admin', is_active: true }],
      rowCount: 1,
    });

    await expect(service.updateRole(admin, 'membership-admin', { role: 'manager' } as any)).rejects.toThrow(BadRequestException);
    expect(client.query.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE company_memberships'))).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('allows an admin to update a staff membership to manager', async () => {
    memberships.requireOwnerOrAdmin.mockResolvedValue({ companyId: 'company-1', branchId: null, role: 'admin' });
    client.query
      .mockResolvedValueOnce({ rows: [{ id: 'membership-3', user_id: 'user-3', role: 'staff', is_active: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'membership-3', user_id: 'user-3', role: 'manager', is_active: true }], rowCount: 1 });

    const result = await service.updateRole(owner, 'membership-3', { role: 'manager' } as any);

    expect(result.role).toBe('manager');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-1',
      action: 'update_role',
      entityId: 'membership-3',
      oldValues: { role: 'staff' },
      newValues: { role: 'manager' },
    }));
  });
});
