import { describe, expect, it, vi } from 'vitest';
import { SubscriptionsService } from './subscriptions.service.js';

function makeService(subscriptionRows: Array<{ status: string; plan_code: string; plan_name: string; modules: string[] }>, overrides: Array<{ module_code: string; enabled: boolean }> = []) {
  const db = {
    query: vi.fn()
      .mockResolvedValueOnce({ rows: subscriptionRows, rowCount: subscriptionRows.length })
      .mockResolvedValueOnce({ rows: overrides, rowCount: overrides.length }),
  };
  return { service: new SubscriptionsService(db as never), db };
}

describe('SubscriptionsService.getModuleCatalogue', () => {
  it('requires a plan for optional modules while preserving core access for legacy tenants', async () => {
    const { service } = makeService([]);
    const result = await service.getModuleCatalogue('company-1');
    expect(result.accessMode).toBe('subscription_required');
    expect(result.subscription).toBeNull();
    expect(result.modules.find((module) => module.code === 'core')?.enabled).toBe(true);
    expect(result.modules.find((module) => module.code === 'manufacturing')).toMatchObject({
      includedInPlan: false, entitled: false, enabled: false, status: 'not_included',
    });
  });

  it('reports modules excluded from an active plan as unavailable', async () => {
    const { service } = makeService([{
      status: 'active', plan_code: 'starter', plan_name: 'Starter',
      modules: ['core', 'inventory', 'sales', 'pos'],
    }]);
    const result = await service.getModuleCatalogue('company-1');
    expect(result.modules.find((module) => module.code === 'manufacturing')).toMatchObject({
      includedInPlan: false, entitled: false, enabled: false, status: 'not_included',
    });
  });

  it('does not enable a module when a required dependency is disabled by override', async () => {
    const { service } = makeService([{
      status: 'active', plan_code: 'business', plan_name: 'Business',
      modules: ['core', 'inventory', 'sales', 'pos', 'accounting', 'procurement', 'crm', 'reports'],
    }], [{ module_code: 'inventory', enabled: false }]);
    const result = await service.getModuleCatalogue('company-1');
    expect(result.modules.find((module) => module.code === 'pos')).toMatchObject({
      entitled: true, enabled: false, status: 'missing_dependencies',
    });
  });

  it('marks all subscribed modules unavailable for an inactive subscription', async () => {
    const { service } = makeService([{
      status: 'past_due', plan_code: 'starter', plan_name: 'Starter',
      modules: ['core', 'inventory', 'sales'],
    }]);
    const result = await service.getModuleCatalogue('company-1');
    expect(result.modules.find((module) => module.code === 'inventory')).toMatchObject({
      entitled: true, enabled: false, status: 'subscription_inactive',
    });
  });
});
