import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PermissionsGuard } from './permissions.guard.js';

function makeGuard(required: string[] | undefined, permissions?: string[]) {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(required) };
  const guard = new PermissionsGuard(reflector as never);
  const context = {
    getHandler: () => 'handler',
    getClass: () => 'controller',
    switchToHttp: () => ({ getRequest: () => ({ user: permissions === undefined ? undefined : { permissions } }) }),
  } as never;
  return { guard, context, reflector };
}

describe('PermissionsGuard', () => {
  it('allows a user who has every required permission', () => {
    const { guard, context, reflector } = makeGuard(['sales:read', 'sales:write'], ['sales:read', 'sales:write', 'customers:read']);
    expect(guard.canActivate(context)).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith('permissions', ['handler', 'controller']);
  });

  it('rejects a user who is missing any one of the required permissions', () => {
    const { guard, context } = makeGuard(['sales:read', 'sales:write'], ['sales:read']);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects a request without an authenticated user when permissions are required', () => {
    const { guard, context } = makeGuard(['customers:read']);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows routes without permission metadata', () => {
    const { guard, context } = makeGuard(undefined);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows routes with an explicitly empty permission list', () => {
    const { guard, context } = makeGuard([]);
    expect(guard.canActivate(context)).toBe(true);
  });
});
