import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import { RequisitionsService } from './requisitions.service.js';

type Mock = ReturnType<typeof vi.fn>;

describe('RequisitionsService approval submission', () => {
  let service: RequisitionsService;
  let db: { query: Mock; transaction: Mock };
  let client: { query: Mock };
  let memberships: { getMembership: Mock; getMembershipForCompany: Mock };
  let audit: { log: Mock };
  const user = { userId: 'requester-1', companyId: 'company-1', branchId: null } as any;

  beforeEach(async () => {
    client = { query: vi.fn() };
    db = {
      query: vi.fn(),
      transaction: vi.fn((callback: (client: { query: Mock }) => Promise<unknown>) => callback(client)),
    };
    memberships = {
      getMembership: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null, role: 'staff' }),
      getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null, role: 'staff' }),
    };
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequisitionsService,
        { provide: DatabaseService, useValue: db },
        { provide: MembershipsService, useValue: memberships },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = module.get(RequisitionsService);
  });

  it('submits a draft into approval and creates a pending approval request in the same transaction', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM requisitions') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'req-1', company_id: 'company-1', branch_id: null, requester_user_id: user.userId, status: 'draft' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'req-1', company_id: 'company-1', requester_user_id: user.userId, status: 'pending_approval' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await service.submit(user, 'req-1');

    expect(result.status).toBe('pending_approval');
    const calls = client.query.mock.calls as unknown as [string, unknown[]?][];
    expect(calls[0][0]).toContain('WHERE company_id=$1 AND id=$2 FOR UPDATE');
    expect(calls[0][1]).toEqual(['company-1', 'req-1']);
    expect(calls.some(([sql, params]) => sql.includes('INSERT INTO approval_requests') && sql.includes("'pending'") && params?.[2] === 'req-1' && params?.[3] === user.userId)).toBe(true);
    expect(calls.some(([sql, params]) => sql.includes("UPDATE requisitions SET status='pending_approval'") && params?.[0] === 'company-1' && params?.[1] === 'req-1')).toBe(true);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-1', action: 'submit_for_approval', entityType: 'requisition', entityId: 'req-1',
    }));
  });

  it('prevents a different user from submitting the requisition', async () => {
    client.query.mockResolvedValueOnce({
      rows: [{ id: 'req-1', company_id: 'company-1', requester_user_id: 'another-user', status: 'draft' }],
      rowCount: 1,
    });

    await expect(service.submit(user, 'req-1')).rejects.toThrow(BadRequestException);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO approval_requests'))).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('does not resubmit a requisition that is already pending approval', async () => {
    client.query.mockResolvedValueOnce({
      rows: [{ id: 'req-1', company_id: 'company-1', requester_user_id: user.userId, status: 'pending_approval' }],
      rowCount: 1,
    });

    await expect(service.submit(user, 'req-1')).rejects.toThrow(BadRequestException);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO approval_requests'))).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects requisitions assigned to an inactive branch', async () => {
    client.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(service.create(user, {
      branchId: 'inactive-branch', title: 'Office supplies', items: [{ productId: 'product-1', quantity: 1 }],
    } as any)).rejects.toThrow('Active branch not found in this company.');
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('AND is_active=true'),
      ['inactive-branch', 'company-1'],
    );
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('prevents branch-bound members from creating requisitions for another branch', async () => {
    memberships.getMembershipForCompany.mockResolvedValue({ companyId: 'company-1', branchId: 'branch-a', role: 'staff' });
    const branchUser = { ...user, branchId: 'branch-a' };
    await expect(service.create(branchUser, {
      branchId: 'branch-b', title: 'Office supplies', items: [{ productId: 'product-1', quantity: 1 }],
    } as any)).rejects.toThrow(ForbiddenException);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('prevents branch-bound members from submitting another branch requisition', async () => {
    memberships.getMembershipForCompany.mockResolvedValue({ companyId: 'company-1', branchId: 'branch-a', role: 'staff' });
    const branchUser = { ...user, branchId: 'branch-a' };
    client.query.mockResolvedValueOnce({
      rows: [{ id: 'req-2', company_id: 'company-1', branch_id: 'branch-b', requester_user_id: branchUser.userId, status: 'draft' }],
      rowCount: 1,
    });
    await expect(service.submit(branchUser, 'req-2')).rejects.toThrow('Requisition not found in this branch.');
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO approval_requests'))).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('returns not found for a requisition outside the active company', async () => {
    client.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(service.submit(user, 'req-from-another-company')).rejects.toThrow(NotFoundException);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE company_id=$1 AND id=$2 FOR UPDATE'),
      ['company-1', 'req-from-another-company'],
    );
    expect(audit.log).not.toHaveBeenCalled();
  });
});
