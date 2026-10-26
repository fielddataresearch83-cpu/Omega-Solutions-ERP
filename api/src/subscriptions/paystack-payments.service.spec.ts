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
