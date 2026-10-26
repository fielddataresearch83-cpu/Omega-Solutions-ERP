import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ModuleEntitlementsGuard } from './module-entitlements.guard.js';

function context(companyId: string | null = 'company-1') {
  return { getHandler: () => 'handler', getClass: () => 'controller',
    switchToHttp: () => ({ getRequest: () => ({ user: { companyId } }) }) } as never;
}
function makeGuard(required: string, subscriptions: {status:string;modules:string[]}[], overrides: {module_code:string;enabled:boolean}[] = []) {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(required) };
  const database = { query: vi.fn().mockResolvedValueOnce({rows:subscriptions,rowCount:subscriptions.length})
    .mockResolvedValue({rows:overrides,rowCount:overrides.length}) };
  return { guard: new ModuleEntitlementsGuard(reflector as never, database as never), database };
}
describe('ModuleEntitlementsGuard', () => {
  it('preserves existing access without an assigned subscription', async () => {
    const {guard,database}=makeGuard('inventory',[]);
    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(database.query).toHaveBeenCalledTimes(1);
  });
  it('allows an enabled module with its dependencies', async () => {
    const {guard}=makeGuard('pos',[{status:'active',modules:['core','inventory','sales','pos']}]);
    await expect(guard.canActivate(context())).resolves.toBe(true);
  });
  it('blocks modules excluded from the plan', async () => {
    const {guard}=makeGuard('manufacturing',[{status:'active',modules:['core','inventory','sales','pos']}]);
    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('blocks a module if an override disables a dependency', async () => {
    const {guard}=makeGuard('pos',[{status:'active',modules:['core','inventory','sales','pos']}],[{module_code:'inventory',enabled:false}]);
    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('blocks procurement when accounting is not included in the plan', async () => {
    const {guard}=makeGuard('procurement',[{status:'active',modules:['core','inventory','sales','procurement']}]);
    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('allows procurement when inventory and accounting dependencies are included', async () => {
    const {guard}=makeGuard('procurement',[{status:'active',modules:['core','inventory','sales','accounting','procurement']}]);
    await expect(guard.canActivate(context())).resolves.toBe(true);
  });
  it('blocks inactive subscriptions', async () => {
    const {guard}=makeGuard('inventory',[{status:'past_due',modules:['core','inventory']}]);
    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('requires a selected company', async () => {
    const {guard,database}=makeGuard('inventory',[]);
    await expect(guard.canActivate(context(null))).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.query).not.toHaveBeenCalled();
  });
});
