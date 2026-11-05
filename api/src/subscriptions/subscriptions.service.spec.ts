import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SubscriptionsService } from './subscriptions.service.js';

const passthroughCache = { getOrLoad: (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader() };

describe('SubscriptionsService.assertUserCapacity', () => {
  it('locks the company subscription row before counting users in a transaction', async () => {
    const db = { query: vi.fn() };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ status: 'active', max_users: 1, plan_name: 'Starter' }] })
        .mockResolvedValueOnce({ rows: [{ used: 1 }] }),
    };
    const service = new SubscriptionsService(db as any, passthroughCache as any);

    await expect(service.assertUserCapacity('company-1', client as any))
      .rejects.toBeInstanceOf(ForbiddenException);

    expect(client.query.mock.calls[0][0]).toContain('FOR UPDATE OF s');
    expect(client.query.mock.calls[1][0]).toContain('company_invitations');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('allows an invitation that already reserved the final user slot to be accepted', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ status: 'active', max_users: 1, plan_name: 'Starter' }] })
        .mockResolvedValueOnce({ rows: [{ used: 1 }] }),
    };
    const service = new SubscriptionsService({ query: vi.fn() } as any, passthroughCache as any);

    await expect(service.assertUserCapacity('company-1', client as any, true)).resolves.toBeUndefined();
    expect(client.query.mock.calls[0][0]).toContain('FOR UPDATE OF s');
  });
});

describe('SubscriptionsService missing-plan safeguards', () => {
  it('blocks adding users when no subscription exists', async () => {
    const service = new SubscriptionsService({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } as any, passthroughCache as any);
    await expect(service.assertUserCapacity('company-legacy')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks adding branches when no subscription exists', async () => {
    const service = new SubscriptionsService({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } as any, passthroughCache as any);
    await expect(service.assertBranchCapacity('company-legacy')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('SubscriptionsService.getModuleCatalogue', () => {
  it('exposes core only and reports a plan requirement for a legacy company', async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
    };
    const service = new SubscriptionsService(db as any, passthroughCache as any);
    const result = await service.getModuleCatalogue('company-legacy');
    expect(result.accessMode).toBe('subscription_required');
    expect(result.modules.find((module) => module.code === 'core')?.enabled).toBe(true);
    expect(result.modules.filter((module) => module.code !== 'core').every((module) => !module.enabled)).toBe(true);
  });
});
