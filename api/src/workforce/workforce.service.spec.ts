import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { WorkforceService } from './workforce.service.js';

describe('WorkforceService validation and attendance', () => {
  let db: { query: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> };
  let memberships: { getMembership: ReturnType<typeof vi.fn>; getMembershipForCompany: ReturnType<typeof vi.fn> };
  let audit: { log: ReturnType<typeof vi.fn> };
  let service: WorkforceService;
  const user = { userId: 'user-a', email: 'a@example.test', fullName: 'A', companyId: 'company-a', branchId: null, role: 'owner', permissions: [] };

  beforeEach(() => {
    db = { query: vi.fn(), transaction: vi.fn() };
    memberships = { getMembership: vi.fn(), getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-a', branchId: null, role: 'owner' }) };
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    service = new WorkforceService(db as never, memberships as never, audit as never);
  });

  it('scopes client site reads to the authenticated company', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await service.sites(user);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE company_id=$1'),
      ['company-a'],
    );
  });

  it('scopes assignment reads and employee joins to the authenticated company', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await service.assignments(user);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE a.company_id=$1');
    expect(sql).toContain('e.company_id=a.company_id');
    expect(sql).toContain('s.company_id=a.company_id');
    expect(params).toEqual(['company-a']);
  });

  it('scopes attendance reads to the authenticated company and uses an inclusive end date', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await service.attendance(user, '2026-10-01', '2026-10-15');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE a.company_id=$1');
    expect(sql).toContain('a.punched_at >= $3::date');
    expect(sql).toContain("a.punched_at < ($4::date + INTERVAL '1 day')");
    expect(params).toEqual(['company-a', null, '2026-10-01', '2026-10-15']);
  });

  it('filters workforce assignment listing to a branch-bound member branch', async () => {
    const branchUser = { ...user, branchId: 'branch-a', role: 'manager' };
    memberships.getMembershipForCompany.mockResolvedValue({ companyId: 'company-a', branchId: 'branch-a', role: 'manager' });
    db.query.mockResolvedValue({ rows: [] });
    await service.assignments(branchUser);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('e.branch_id=$2::uuid');
    expect(params).toEqual(['company-a', 'branch-a']);
  });

  it('filters attendance reads to a branch-bound member branch', async () => {
    const branchUser = { ...user, branchId: 'branch-a', role: 'manager' };
    memberships.getMembershipForCompany.mockResolvedValue({ companyId: 'company-a', branchId: 'branch-a', role: 'manager' });
    db.query.mockResolvedValue({ rows: [] });
    await service.attendance(branchUser);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('e.branch_id=$2::uuid');
    expect(params).toEqual(['company-a', 'branch-a']);
  });

  it('blocks branch-bound members from company-wide monthly attendance imports', async () => {
    const branchUser = { ...user, branchId: 'branch-a', role: 'manager' };
    memberships.getMembershipForCompany.mockResolvedValue({ companyId: 'company-a', branchId: 'branch-a', role: 'manager' });
    await expect(service.previewMonthlyAttendance(branchUser, {
      period: '2026-09',
      rows: [{ nationalId: '12345678', scheduledDays: 22, presentDays: 20, absentDays: 1, leaveDays: 1, unresolvedDays: 0, restDays: 8 }],
    })).rejects.toThrow(ForbiddenException);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects invalid date filters before querying attendance', async () => {
    await expect(service.attendance(user, 'not-a-date')).rejects.toThrow(BadRequestException);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects impossible calendar dates before querying attendance', async () => {
    await expect(service.attendance(user, '2026-02-30')).rejects.toThrow(BadRequestException);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects an inverted attendance date range before querying', async () => {
    await expect(service.attendance(user, '2026-10-16', '2026-10-15')).rejects.toThrow(BadRequestException);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects monthly import totals that do not reconcile before matching employees', async () => {
    await expect(service.previewMonthlyAttendance(user, {
      period: '2026-09',
      rows: [{ nationalId: '12345678', scheduledDays: 22, presentDays: 20, absentDays: 1, leaveDays: 0, unresolvedDays: 0, restDays: 8 }],
    })).rejects.toThrow(BadRequestException);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('matches monthly attendance by national ID only inside the authenticated company and masks it in preview', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'employee-a', first_name: 'Ada', last_name: 'Worker', employee_number: 'E-1' }] });
    const result = await service.previewMonthlyAttendance(user, {
      period: '2026-09', sourceType: 'csv',
      rows: [{ nationalId: '12 345-678', scheduledDays: 22, presentDays: 20, absentDays: 1, leaveDays: 1, unresolvedDays: 0, restDays: 8 }],
    });
    expect(db.query.mock.calls[0][0]).toContain('WHERE company_id=$1');
    expect(db.query.mock.calls[0][1]).toEqual(['company-a', '12345678']);
    expect(result.readyToImport).toBe(true);
    expect(result.rows[0].nationalIdMasked).toBe('••••5678');
    expect(JSON.stringify(result)).not.toContain('12345678');
  });

  it('rejects invalid punch type before opening a transaction', async () => {
    await expect(service.punch(user, { employeeId: 'employee-a', punchType: 'break' })).rejects.toThrow(BadRequestException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('requires a clock-in before the first clock-out event', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'employee-a' }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    db.transaction.mockImplementation(async (work: (connection: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => work(client));
    await expect(service.punch(user, { employeeId: 'employee-a', punchType: 'out' })).rejects.toThrow(BadRequestException);
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it('rejects a timestamp too far in the future before opening a transaction', async () => {
    await expect(service.punch(user, { employeeId: 'employee-a', punchType: 'in', punchedAt: '2099-01-01T00:00:00Z' })).rejects.toThrow(BadRequestException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects transfers after the current assignment end date', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [{ start_date: '2026-10-01', end_date: '2026-10-10' }] }) };
    db.transaction.mockImplementation(async (work: (connection: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => work(client));
    await expect(service.transfer(user, 'assignment-a', { effectiveDate: '2026-10-11', siteId: 'site-b', payBasis: 'monthly', payRate: 1000 })).rejects.toThrow(BadRequestException);
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('requires a valid pay basis before opening an assignment transaction', async () => {
    await expect(service.createAssignment(user, { employeeId: 'employee-a', siteId: 'site-a', startDate: '2026-10-15', payBasis: 'weekly', payRate: 1000 })).rejects.toThrow(BadRequestException);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
