import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PaystackPaymentsService } from './paystack-payments.service.js';

describe('PaystackPaymentsService custom-priced plans', () => {
  it('refuses online checkout for Enterprise before reading payment credentials or creating a payment', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [{ code: 'enterprise_custom', name: 'Enterprise', monthly_price_kes: 0, is_custom_pricing: true }],
        rowCount: 1,
      }),
    };
    const service = new PaystackPaymentsService(db as never);

    await expect(
      service.initializeSubscriptionCheckout('company-1', 'user-1', 'owner@example.test', 'enterprise_custom'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(db.query).toHaveBeenCalledTimes(1);
  });
});


describe('PaystackPaymentsService checkout serialization', () => {
  it('rejects a second pending checkout for the same company before creating another payment', async () => {
    const originalMode = process.env.PAYSTACK_MODE;
    const originalKey = process.env.PAYSTACK_SECRET_KEY;
    process.env.PAYSTACK_MODE = 'test';
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit_test_key';
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM company_subscriptions')) return { rows: [], rowCount: 0 };
        if (sql.includes('FROM subscription_payments')) return { rows: [{ reference: 'omega-sub-existing' }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
    };
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [{ code: 'starter', name: 'Starter', monthly_price_kes: 1500, is_custom_pricing: false }],
        rowCount: 1,
      }),
      transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(client)),
    };
    const service = new PaystackPaymentsService(db as never);

    try {
      await expect(
        service.initializeSubscriptionCheckout('company-1', 'user-1', 'owner@example.test', 'starter'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(client.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        ['omega-subscription-checkout:company-1'],
      );
      expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO subscription_payments'))).toBe(false);
      expect(db.query).toHaveBeenCalledTimes(1);
    } finally {
      if (originalMode === undefined) delete process.env.PAYSTACK_MODE;
      else process.env.PAYSTACK_MODE = originalMode;
      if (originalKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = originalKey;
    }
  });
});
