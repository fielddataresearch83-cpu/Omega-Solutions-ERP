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
