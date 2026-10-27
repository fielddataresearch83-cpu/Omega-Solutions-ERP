import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ContractsService } from './contracts.service.js';

type Mock = ReturnType<typeof vi.fn>;

describe('ContractsService branch mutation authorization', () => {
  let service: ContractsService;
  let db: { query: Mock; transaction: Mock };
  let memberships: { getMembership: Mock; getMembershipForCompany: Mock };
  let audit: { log: Mock };
  const user = { userId: 'user-branch-a', companyId: 'company-1', branchId: 'branch-a' } as any;

  beforeEach(async () => {
    db = {
      query: vi.fn(),
      transaction: vi.fn(),
    };
    memberships = {
      getMembership: vi.fn(),
      getMembershipForCompany: vi.fn().mockResolvedValue({
        companyId: 'company-1',
        branchId: 'branch-a',
        role: 'staff',
      }),
    };
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractsService,
        { provide: DatabaseService, useValue: db },
        { provide: MembershipsService, useValue: memberships },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = module.get(ContractsService);
  });

  it('allows branch-bound members to view company-wide contracts but blocks editing them', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'contract-shared', company_id: 'company-1', branch_id: null, status: 'draft' }],
      rowCount: 1,
    });

    await expect(service.update(user, 'contract-shared', { title: 'Changed title' }))
      .rejects.toThrow(ForbiddenException);

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('blocks adding obligations to a company-wide contract from a branch-bound membership', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'contract-shared', company_id: 'company-1', branch_id: null, status: 'active' }],
      rowCount: 1,
    });

    await expect(service.addObligation(user, 'contract-shared', { title: 'Renewal review' }))
      .rejects.toThrow(ForbiddenException);

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects generating a requisition when the contract branch is inactive', async () => {
    const txQuery = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM contracts')) return { rows: [{
        id: 'contract-a', company_id: 'company-1', branch_id: 'inactive-branch',
        status: 'active', title: 'Cleaning services', contract_number: 'CON-2026-00001',
      }], rowCount: 1 };
      if (sql.includes('FROM contract_items')) return { rows: [{
        product_id: 'product-1', description: 'Cleaning materials', quantity: 2, unit: 'pack',
      }], rowCount: 1 };
      if (sql.includes('FROM branches')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    db.transaction.mockImplementation(async (callback: (client: { query: Mock }) => Promise<unknown>) =>
      callback({ query: txQuery }),
    );

    await expect(service.createRequisition(user, 'contract-a'))
      .rejects.toThrow('Active branch not found in this company.');

    expect(txQuery).toHaveBeenCalledWith(
      expect.stringContaining('AND is_active=true'),
      ['inactive-branch', 'company-1'],
    );
    expect(txQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO requisitions'))).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rechecks the locked contract status before changing status', async () => {
    db.transaction.mockImplementation(async (callback: (client: { query: Mock }) => Promise<unknown>) =>
      callback({ query: vi.fn().mockResolvedValue({ rows: [{
        id: 'contract-a', company_id: 'company-1', branch_id: 'branch-a',
        status: 'pending_approval', created_by: user.userId,
      }], rowCount: 1 }) }),
    );

    await expect(service.changeStatus(user, 'contract-a', 'active'))
      .rejects.toThrow('Only draft or suspended contracts can be activated.');
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rechecks creator and status under lock before submitting for approval', async () => {
    db.transaction.mockImplementation(async (callback: (client: { query: Mock }) => Promise<unknown>) =>
      callback({ query: vi.fn().mockResolvedValue({ rows: [{
        id: 'contract-a', company_id: 'company-1', branch_id: 'branch-a',
        status: 'pending_approval', created_by: user.userId,
      }], rowCount: 1 }) }),
    );

    await expect(service.submitForApproval(user, 'contract-a'))
      .rejects.toThrow('Only draft or suspended contracts can be submitted for approval.');
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects an edit if the contract leaves draft status before the update transaction locks it', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'contract-a', company_id: 'company-1', branch_id: 'branch-a', status: 'draft' }],
      rowCount: 1,
    });
    const txQuery = vi.fn().mockResolvedValue({
      rows: [{ id: 'contract-a', status: 'pending_approval', branch_id: 'branch-a' }],
      rowCount: 1,
    });
    db.transaction.mockImplementation(async (callback: (client: { query: Mock }) => Promise<unknown>) =>
      callback({ query: txQuery }),
    );

    await expect(service.update(user, 'contract-a', { title: 'Late edit' }))
      .rejects.toThrow('Only draft contracts can be edited. Submit the contract again after making changes.');

    expect(txQuery).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      ['company-1', 'contract-a', 'branch-a'],
    );
    expect(txQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE contracts SET'))).toBe(false);
    expect(txQuery.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM contract_items'))).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('allows mutation checks to proceed for a contract assigned to the member branch', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'contract-a', company_id: 'company-1', branch_id: 'branch-a', status: 'draft' }],
      rowCount: 1,
    });
    db.transaction.mockImplementation(async (callback: (client: { query: Mock }) => Promise<unknown>) =>
      callback({ query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id,status,branch_id FROM contracts')) {
          return { rows: [{ id: 'contract-a', status: 'draft', branch_id: 'branch-a' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }) }),
    );
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'contract-a', company_id: 'company-1', branch_id: 'branch-a', status: 'draft' }],
      rowCount: 1,
    }).mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await service.update(user, 'contract-a', { title: 'Branch contract' });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-1',
      branchId: 'branch-a',
      action: 'update',
      entityType: 'contract',
      entityId: 'contract-a',
    }));
  });
});
