import { describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller.js';

function responseStub() {
  return { cookie: vi.fn(), clearCookie: vi.fn() } as any;
}

describe('AuthController HttpOnly refresh sessions', () => {
  it('sets a secure HttpOnly cookie and never returns the refresh token in JSON', async () => {
    const auth = { login: vi.fn().mockResolvedValue({
      accessToken: 'access-token', refreshToken: 'refresh-secret',
      user: { userId: 'user-1', email: 'user@example.com', fullName: 'User', companyId: 'company-1', branchId: null, role: 'owner' },
    }) };
    const controller = new AuthController(auth as any, {} as any);
    const response = responseStub();
    const result = await controller.login({ email: 'user@example.com', password: 'password' } as any, response);
    expect(result).not.toHaveProperty('refreshToken');
    expect(result).toHaveProperty('accessToken', 'access-token');
    expect(response.cookie).toHaveBeenCalledWith('omega_refresh', 'refresh-secret', expect.objectContaining({
      httpOnly: true, secure: true, sameSite: 'none', path: '/api/auth',
    }));
  });

  it('rotates using the HttpOnly cookie and sets the replacement cookie', async () => {
    const auth = { refresh: vi.fn().mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh' }) };
    const controller = new AuthController(auth as any, {} as any);
    const response = responseStub();
    const request = { headers: { cookie: 'other=value; omega_refresh=old-refresh' } } as any;
    const result = await controller.refresh({}, request, response);
    expect(auth.refresh).toHaveBeenCalledWith({ refreshToken: 'old-refresh' });
    expect(result).toEqual({ accessToken: 'new-access' });
    expect(response.cookie).toHaveBeenCalledWith('omega_refresh', 'new-refresh', expect.any(Object));
  });

  it('revokes the cookie session on logout and clears the cookie', async () => {
    const auth = { revokeRefreshToken: vi.fn().mockResolvedValue(undefined) };
    const controller = new AuthController(auth as any, {} as any);
    const response = responseStub();
    const request = { headers: { cookie: 'omega_refresh=refresh-secret' } } as any;
    const result = await controller.logout({}, request, response);
    expect(auth.revokeRefreshToken).toHaveBeenCalledWith('refresh-secret');
    expect(response.clearCookie).toHaveBeenCalledWith('omega_refresh', expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'none', path: '/api/auth' }));
    expect(result).toEqual({ success: true });
  });
});

describe('AuthController company switching authorization boundary', () => {
  it('uses the authenticated user, issues the target session, then revokes the previous session family', async () => {
    const auth = {
      switchCompany: vi.fn().mockResolvedValue({
        accessToken: 'target-access', refreshToken: 'target-refresh',
        user: { userId: 'user-1', email: 'user@example.com', fullName: 'User', companyId: 'company-b', branchId: 'branch-b', role: 'manager' },
      }),
      revokeSessionFamily: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new AuthController(auth as any, {} as any);
    const response = responseStub();
    const result = await controller.switchCompany(
      { user: { userId: 'user-1', sessionFamilyId: 'old-family', mfaVerified: true } } as any,
      { companyId: 'company-b' } as any,
      response,
    );

    expect(auth.switchCompany).toHaveBeenCalledWith('user-1', 'company-b', true);
    expect(auth.revokeSessionFamily).toHaveBeenCalledWith('old-family');
    expect(auth.switchCompany.mock.invocationCallOrder[0]).toBeLessThan(auth.revokeSessionFamily.mock.invocationCallOrder[0]);
    expect(result).toMatchObject({ accessToken: 'target-access', user: { companyId: 'company-b', branchId: 'branch-b' } });
    expect(result).not.toHaveProperty('refreshToken');
    expect(response.cookie).toHaveBeenCalledWith('omega_refresh', 'target-refresh', expect.any(Object));
  });

  it('does not revoke the existing session family when the target company is not authorized', async () => {
    const auth = {
      switchCompany: vi.fn().mockRejectedValue(new Error('Not an active company membership')),
      revokeSessionFamily: vi.fn(),
    };
    const controller = new AuthController(auth as any, {} as any);

    await expect(controller.switchCompany(
      { user: { userId: 'user-1', sessionFamilyId: 'old-family', mfaVerified: false } } as any,
      { companyId: 'company-foreign' } as any,
      responseStub(),
    )).rejects.toThrow('Not an active company membership');

    expect(auth.switchCompany).toHaveBeenCalledWith('user-1', 'company-foreign', false);
    expect(auth.revokeSessionFamily).not.toHaveBeenCalled();
  });
});
