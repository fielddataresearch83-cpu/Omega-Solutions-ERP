import { describe, expect, it, vi } from 'vitest';
import { calculateRemittanceDueDate, PayrollRemittancesService } from './payroll-remittances.service.js';

const user = {
  userId: 'user-a', email: 'a@example.test', fullName: 'A',
  companyId: null, branchId: null, role: 'owner', permissions: [],
};

type MockClient = { query: ReturnType<typeof vi.fn> };

describe('PayrollRemittancesService', () => {
  it('lists obligations only for the active company', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }), transaction: vi.fn() } as never;
    const memberships = { getMembership: vi.fn().mockResolvedValue({ companyId: 'company-a' }) } as never;
    const service = new PayrollRemittancesService(db, memberships, {log:vi.fn().mockResolvedValue(undefined),logInTransaction:vi.fn().mockResolvedValue(undefined)} as never);
    await service.list(user);
    const query = (db as { query: ReturnType<typeof vi.fn> }).query;
    expect(query.mock.calls[0][1]).toEqual(['company-a']);
    expect(query.mock.calls[0][0]).toContain('WHERE o.company_id=$1');
    expect(query.mock.calls[0][0]).toContain('payroll_remittance_payments');
  });

  it('calculates the 9th of the following month for PAYE, NSSF and SHIF', () => {
    expect(calculateRemittanceDueDate('PAYE', '2026-10-31')).toBe('2026-11-09');
    expect(calculateRemittanceDueDate('NSSF', '2026-10-31')).toBe('2026-11-09');
    expect(calculateRemittanceDueDate('SHIF', '2026-10-31')).toBe('2026-11-09');
  });

  it('calculates the ninth weekday after month-end for housing levy', () => {
    expect(calculateRemittanceDueDate('HOUSING_LEVY', '2026-10-31')).toBe('2026-11-12');
  });

  it('rejects invalid payroll period end dates', () => {
    expect(() => calculateRemittanceDueDate('PAYE', 'not-a-date')).toThrow('valid calendar date');
  });

  it('previews an approved run without inserting remittance obligations', async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'run-a', period_start: '2026-10-01', period_end: '2026-10-31', status: 'approved' }] })
        .mockResolvedValueOnce({ rows: [{ paye: '100.25', nssf: '200.00', shif: '30.00', housing_levy: '40.00' }] }),
      transaction: vi.fn(),
    } as never;
    const memberships = { getMembership: vi.fn().mockResolvedValue({ companyId: 'company-a' }) } as never;
    const service = new PayrollRemittancesService(db, memberships, {log:vi.fn().mockResolvedValue(undefined),logInTransaction:vi.fn().mockResolvedValue(undefined)} as never);
    const result = await service.previewForRun(user, 'run-a');
    expect(result.previewOnly).toBe(true);
    expect(result.persisted).toBe(false);
    expect(result.obligations).toHaveLength(4);
    expect(result.obligations[0]).toMatchObject({ authority: 'PAYE', amount: '100.25', dueDate: '2026-11-09' });
    expect((db as { transaction: ReturnType<typeof vi.fn> }).transaction).not.toHaveBeenCalled();
    expect((db as { query: ReturnType<typeof vi.fn> }).query).toHaveBeenCalledTimes(2);
  });

  it('does not preview payroll runs outside the active company or before approval', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }), transaction: vi.fn() } as never;
    const memberships = { getMembership: vi.fn().mockResolvedValue({ companyId: 'company-a' }) } as never;
    const service = new PayrollRemittancesService(db, memberships, {log:vi.fn().mockResolvedValue(undefined),logInTransaction:vi.fn().mockResolvedValue(undefined)} as never);
    await expect(service.previewForRun(user, 'run-other')).rejects.toThrow('approved or posted payroll run');
    expect((db as { query: ReturnType<typeof vi.fn> }).query.mock.calls[0][1]).toEqual(['run-other', 'company-a']);
    expect((db as { transaction: ReturnType<typeof vi.fn> }).transaction).not.toHaveBeenCalled();
  });

  it('does not generate obligations from a draft payroll run', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'run-a', status: 'draft' }] }) };
    const db = { query: vi.fn(), transaction: vi.fn(async (callback: (client: MockClient) => unknown) => callback(client)) } as never;
    const memberships = { getMembership: vi.fn().mockResolvedValue({ companyId: 'company-a' }) } as never;
    const service = new PayrollRemittancesService(db, memberships, {log:vi.fn().mockResolvedValue(undefined),logInTransaction:vi.fn().mockResolvedValue(undefined)} as never);
    await expect(service.generateForRun(user, 'run-a')).rejects.toThrow('only be generated from a posted payroll run');
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('generates only positive statutory obligations from a posted run with tenant-scoped periods and due dates', async () => {
    const client: MockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'run-a', period_start: '2026-10-01', period_end: '2026-10-31', status: 'posted' }] })
        .mockResolvedValueOnce({ rows: [{ paye: '100.25', nssf: '0.00', shif: '30.00', housing_levy: '40.00' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'obligation-paye', authority: 'PAYE', amount: '100.25', due_date: '2026-11-09' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'obligation-shif', authority: 'SHIF', amount: '30.00', due_date: '2026-11-09' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'obligation-housing', authority: 'HOUSING_LEVY', amount: '40.00', due_date: '2026-11-12' }] }),
    };
    const db = { query: vi.fn(), transaction: vi.fn(async (callback: (client: MockClient) => unknown) => callback(client)) } as never;
    const memberships = { getMembership: vi.fn().mockResolvedValue({ companyId: 'company-a' }) } as never;
    const service = new PayrollRemittancesService(db, memberships, {log:vi.fn().mockResolvedValue(undefined),logInTransaction:vi.fn().mockResolvedValue(undefined)} as never);
    const result = await service.generateForRun(user, 'run-a');
    expect(client.query).toHaveBeenCalledTimes(5);
    expect(result.created).toHaveLength(3);
    expect(client.query.mock.calls[2][1]).toEqual([
      'company-a', 'run-a', 'PAYE', '2026-10-01', '2026-10-31', '2026-11-09', 100.25, 'user-a',
    ]);
    expect(client.query.mock.calls[3][1]).toEqual([
      'company-a', 'run-a', 'SHIF', '2026-10-01', '2026-10-31', '2026-11-09', 30, 'user-a',
    ]);
    expect(client.query.mock.calls[4][1]).toEqual([
      'company-a', 'run-a', 'HOUSING_LEVY', '2026-10-01', '2026-10-31', '2026-11-12', 40, 'user-a',
    ]);
  });

  it('rejects payments above the tenant-scoped outstanding balance', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'obligation-a', amount: '100.00' }] })
        .mockResolvedValueOnce({ rows: [{ amount_paid: '75.00' }] }),
    };
    const db = { query: vi.fn(), transaction: vi.fn(async (callback: (client: MockClient) => unknown) => callback(client)) } as never;
    const memberships = { getMembership: vi.fn().mockResolvedValue({ companyId: 'company-a' }) } as never;
    const service = new PayrollRemittancesService(db, memberships, {log:vi.fn().mockResolvedValue(undefined),logInTransaction:vi.fn().mockResolvedValue(undefined)} as never);
    await expect(service.recordPayment(user, 'obligation-a', {
      amount: 30, paymentReference: 'MPESA-REF-1',
    })).rejects.toThrow('exceeds the outstanding obligation balance');
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls[0][1]).toEqual(['obligation-a', 'company-a']);
  });

  it('accepts ordinary two-decimal amounts without floating-point false rejection', async () => {
    const client: MockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'obligation-a', amount: '1.00' }] })
        .mockResolvedValueOnce({ rows: [{ amount_paid: '0.00' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'payment-a', amount: '0.29', payment_reference: 'MPESA-REF-29' }] }),
    };
    const db = { query: vi.fn(), transaction: vi.fn(async (callback: (client: MockClient) => unknown) => callback(client)) } as never;
    const memberships = { getMembership: vi.fn().mockResolvedValue({ companyId: 'company-a' }) } as never;
    const service = new PayrollRemittancesService(db, memberships, {log:vi.fn().mockResolvedValue(undefined),logInTransaction:vi.fn().mockResolvedValue(undefined)} as never);
    const result = await service.recordPayment(user, 'obligation-a', { amount: 0.29, paymentReference: 'MPESA-REF-29' });
    expect(result.verificationStatus).toBe('recorded_not_independently_verified');
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  it('requires a non-empty payment reference', async () => {
    const db = { query: vi.fn(), transaction: vi.fn() } as never;
    const memberships = { getMembership: vi.fn() } as never;
    const service = new PayrollRemittancesService(db, memberships, {log:vi.fn().mockResolvedValue(undefined),logInTransaction:vi.fn().mockResolvedValue(undefined)} as never);
    await expect(service.recordPayment(user, 'obligation-a', { amount: 1, paymentReference: '  ' })).rejects.toThrow('paymentReference is required');
    expect((db as { transaction: ReturnType<typeof vi.fn> }).transaction).not.toHaveBeenCalled();
  });

  it('records a partial payment without exceeding the outstanding balance and keeps verification explicit', async () => {
    const client: MockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'obligation-a', amount: '100.00' }] })
        .mockResolvedValueOnce({ rows: [{ amount_paid: '25.00' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'payment-b', obligation_id: 'obligation-a', amount: '30.00', payment_reference: 'BANK-REF-30' }] }),
    };
    const db = { query: vi.fn(), transaction: vi.fn(async (callback: (client: MockClient) => unknown) => callback(client)) } as never;
    const memberships = { getMembership: vi.fn().mockResolvedValue({ companyId: 'company-a' }) } as never;
    const service = new PayrollRemittancesService(db, memberships, {log:vi.fn().mockResolvedValue(undefined),logInTransaction:vi.fn().mockResolvedValue(undefined)} as never);
    const result = await service.recordPayment(user, 'obligation-a', { amount: 30, paymentReference: 'BANK-REF-30' });
    expect(result).toMatchObject({ id: 'payment-b', amount: '30.00', verificationStatus: 'recorded_not_independently_verified' });
    expect(client.query.mock.calls[0][1]).toEqual(['obligation-a', 'company-a']);
    expect(client.query.mock.calls[1][1]).toEqual(['company-a', 'obligation-a']);
    expect(client.query.mock.calls[2][1]).toEqual(['company-a', 'obligation-a', 30, 'BANK-REF-30', expect.any(String), null, null, 'user-a']);
  });

  it('cannot record a payment against another company’s obligation', async () => {
    const client: MockClient = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const db = { query: vi.fn(), transaction: vi.fn(async (callback: (client: MockClient) => unknown) => callback(client)) } as never;
    const memberships = { getMembership: vi.fn().mockResolvedValue({ companyId: 'company-a' }) } as never;
    const service = new PayrollRemittancesService(db, memberships, {log:vi.fn().mockResolvedValue(undefined),logInTransaction:vi.fn().mockResolvedValue(undefined)} as never);
    await expect(service.recordPayment(user, 'obligation-from-company-b', {
      amount: 10, paymentReference: 'CROSS-TENANT-REF',
    })).rejects.toThrow('Remittance obligation not found in this company.');
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0][1]).toEqual(['obligation-from-company-b', 'company-a']);
  });

  it('returns a conflict when a payment reference was already recorded for this company', async () => {
    const client: MockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'obligation-a', amount: '100.00' }] })
        .mockResolvedValueOnce({ rows: [{ amount_paid: '0.00' }] })
        .mockRejectedValueOnce({
          code: '23505',
          constraint: 'payroll_remittance_payments_company_id_payment_reference_key',
        }),
    };
    const db = { query: vi.fn(), transaction: vi.fn(async (callback: (client: MockClient) => unknown) => callback(client)) } as never;
    const memberships = { getMembership: vi.fn().mockResolvedValue({ companyId: 'company-a' }) } as never;
    const service = new PayrollRemittancesService(db, memberships, {log:vi.fn().mockResolvedValue(undefined),logInTransaction:vi.fn().mockResolvedValue(undefined)} as never);
    await expect(service.recordPayment(user, 'obligation-a', {
      amount: 10, paymentReference: 'DUPLICATE-REF',
    })).rejects.toThrow('This payment reference has already been recorded for this company.');
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  it('propagates an unexpected payment insert failure so the transaction can roll back', async () => {
    const insertFailure = new Error('simulated database write failure');
    const client: MockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'obligation-a', amount: '100.00' }] })
        .mockResolvedValueOnce({ rows: [{ amount_paid: '0.00' }] })
        .mockRejectedValueOnce(insertFailure),
    };
    const transaction = vi.fn(async (callback: (client: MockClient) => unknown) => callback(client));
    const db = { query: vi.fn(), transaction } as never;
    const memberships = { getMembership: vi.fn().mockResolvedValue({ companyId: 'company-a' }) } as never;
    const service = new PayrollRemittancesService(db, memberships, {log:vi.fn().mockResolvedValue(undefined),logInTransaction:vi.fn().mockResolvedValue(undefined)} as never);

    await expect(service.recordPayment(user, 'obligation-a', {
      amount: 10, paymentReference: 'WRITE-FAILURE-REF',
    })).rejects.toBe(insertFailure);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  it('blocks company-wide remittance access for branch-bound memberships', async () => {
    const db = { query: vi.fn(), transaction: vi.fn() } as never;
    const memberships = { getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-a', branchId: 'branch-a', role: 'staff' }) } as never;
    const service = new PayrollRemittancesService(db, memberships, {log:vi.fn().mockResolvedValue(undefined),logInTransaction:vi.fn().mockResolvedValue(undefined)} as never);
    const branchUser = { ...user, companyId: 'company-a', branchId: 'branch-a', role: 'staff' };
    await expect(service.list(branchUser)).rejects.toThrow('Payroll remittances are company-wide');
    expect((db as { query: ReturnType<typeof vi.fn> }).query).not.toHaveBeenCalled();
  });

});
