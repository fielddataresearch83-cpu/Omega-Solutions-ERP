import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserPreferencesService } from './user-preferences.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

describe('UserPreferencesService', () => {
  const user: AuthenticatedUser = {
    userId: 'user-a', email: 'a@omega.test', fullName: 'User A',
    companyId: 'company-a', branchId: null, role: 'staff', permissions: [],
  };
  const db = { query: vi.fn() };
  let service: UserPreferencesService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UserPreferencesService(db as never);
  });

  it('loads the date format scoped to the authenticated user and active company', async () => {
    db.query.mockResolvedValue({ rows: [{ date_format: 'DD/MM/YYYY' }] });
    await expect(service.getDisplay(user)).resolves.toEqual({ dateFormat: 'DD/MM/YYYY' });
    expect(db.query.mock.calls[0][1]).toEqual(['user-a', 'company-a']);
  });

  it('returns a safe default when no personal preference exists', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await expect(service.getDisplay(user)).resolves.toEqual({ dateFormat: 'DD MMM YYYY' });
  });

  it('rejects requests without a selected company', async () => {
    await expect(service.getDisplay({ ...user, companyId: null })).rejects.toThrow(BadRequestException);
  });

  it('upserts only against an active company membership', async () => {
    db.query.mockResolvedValue({ rows: [{ date_format: 'YYYY-MM-DD' }] });
    await expect(service.updateDisplay(user, 'YYYY-MM-DD')).resolves.toEqual({ success: true, dateFormat: 'YYYY-MM-DD' });
    expect(db.query.mock.calls[0][1]).toEqual(['user-a', 'company-a', 'YYYY-MM-DD']);
    expect(db.query.mock.calls[0][0]).toContain('cm.is_active = true');
  });

  it('rejects saves when the active membership check matches no row', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await expect(service.updateDisplay(user, 'DD/MM/YYYY')).rejects.toThrow(ForbiddenException);
  });
});
