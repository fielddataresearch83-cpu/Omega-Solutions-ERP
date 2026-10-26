import { describe, expect, it, vi } from 'vitest';
import { MpesaService } from './mpesa.service.js';

describe('MpesaService', () => {
  const user = {
    userId: '11111111-1111-4111-8111-111111111111',
    email: 'cashier@example.test',
    fullName: 'Cashier',
    companyId: '22222222-2222-4222-8222-222222222222',
    branchId: null,
    role: 'manager',
    permissions: ['payments:write'],
  };

  it('rejects invalid Kenyan phone numbers before creating a payment request', async () => {
    const db = { query: vi.fn(), transaction: vi.fn() };
    const memberships = { getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: user.companyId }) };
    const invoices = {};
    const service = new MpesaService(db as never, memberships as never, invoices as never);

    await expect(service.initiate(user, '33333333-3333-4333-8333-333333333333', '12345', 100))
      .rejects.toThrow('Enter a valid Kenyan mobile number');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('does not initiate M-Pesa for an invoice outside the member branch', async () => {
    const db = { query: vi.fn(), transaction: vi.fn() };
    const memberships = { getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: user.companyId, branchId: '44444444-4444-4444-8444-444444444444' }) };
    const invoices = { getById: vi.fn().mockRejectedValue(new Error('Invoice not found.')) };
    const service = new MpesaService(db as never, memberships as never, invoices as never);

    await expect(service.initiate(user, '33333333-3333-4333-8333-333333333333', '0712345678', 100))
      .rejects.toThrow('Invoice not found.');
    expect(invoices.getById).toHaveBeenCalledWith(user, '33333333-3333-4333-8333-333333333333');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('acknowledges unknown callback IDs without creating a payment', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), transaction: vi.fn() };
    const memberships = {};
    const invoices = {};
    const service = new MpesaService(db as never, memberships as never, invoices as never);

    const response = await service.handleCallback({
      Body: { stkCallback: { CheckoutRequestID: 'opaque-unknown-checkout', ResultCode: 0 } },
    });
    expect(response.ResultCode).toBe(0);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
