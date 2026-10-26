import { describe, expect, it, vi } from 'vitest';
import { SubscriptionsService } from './subscriptions.service.js';

describe('SubscriptionsService subscription catalogue', () => {
  it('returns the four active tiers and marks Enterprise as custom-priced', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { code: 'starter', name: 'Starter', description: 'Small business', monthly_price_kes: 1500, is_custom_pricing: false, max_users: 2, max_branches: 1, modules: ['core', 'inventory', 'sales', 'pos', 'reports'] },
          { code: 'medium', name: 'Medium', description: 'Growing business', monthly_price_kes: 3000, is_custom_pricing: false, max_users: 5, max_branches: 3, modules: ['core', 'inventory', 'sales', 'pos', 'reports', 'accounting', 'procurement', 'crm'] },
          { code: 'professional', name: 'Professional', description: 'Established business', monthly_price_kes: 6000, is_custom_pricing: false, max_users: 15, max_branches: 5, modules: ['core', 'inventory', 'sales', 'pos', 'reports', 'accounting', 'procurement', 'crm', 'manufacturing', 'hr_workforce'] },
          { code: 'enterprise_custom', name: 'Enterprise', description: 'Custom', monthly_price_kes: 0, is_custom_pricing: true, max_users: 50, max_branches: 10, modules: ['core', 'inventory', 'sales', 'pos', 'reports', 'accounting', 'procurement', 'crm', 'manufacturing', 'hr_workforce'] },
        ],
        rowCount: 4,
      }),
    };
    const service = new SubscriptionsService(db as never);

    const plans = await service.getPlans();

    expect(plans.map((plan) => [plan.code, plan.name])).toEqual([
      ['starter', 'Starter'],
      ['medium', 'Medium'],
      ['professional', 'Professional'],
      ['enterprise_custom', 'Enterprise'],
    ]);
    expect(plans.map((plan) => plan.monthlyPriceKes)).toEqual([1500, 3000, 6000, 0]);
    expect(plans[3]).toMatchObject({ isCustomPricing: true, limits: { users: 50, branches: 10 } });
  });

  it('records an Enterprise quote request without changing the current subscription', async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ code: 'enterprise_custom' }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{ id: 'request-1', requested_plan_code: 'enterprise_custom', status: 'pending', created_at: new Date('2026-10-26T00:00:00Z') }],
          rowCount: 1,
        }),
    };
    const service = new SubscriptionsService(db as never);

    const result = await service.requestPlanChange('company-1', 'user-1', 'enterprise_custom');

    expect(result.request.requested_plan_code).toBe('enterprise_custom');
    expect(result.message).toContain('Enterprise quote request submitted');
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});
