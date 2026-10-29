import { CrmController } from './crm.controller.js';
import type { CrmService } from './crm.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

describe('CrmController', () => {
  const user: AuthenticatedUser = {
    userId: 'user-1',
    email: 'owner@example.test',
    fullName: 'Test Owner',
    companyId: 'company-1',
    branchId: null,
    role: 'owner',
    permissions: ['crm:read', 'crm:write'],
  };

  it('routes support-ticket updates to updateTicket, not updateOpportunity', async () => {
    const crm = {
      updateTicket: vi.fn().mockResolvedValue({ id: 'ticket-1', status: 'resolved' }),
      updateOpportunity: vi.fn(),
    } as unknown as CrmService;
    const controller = new CrmController(crm);

    const result = await controller.updateTicket(
      { user },
      'ticket-1',
      { status: 'resolved' },
    );

    expect(result).toEqual({ id: 'ticket-1', status: 'resolved' });
    expect(crm.updateTicket).toHaveBeenCalledWith(user, 'ticket-1', { status: 'resolved' });
    expect(crm.updateOpportunity).not.toHaveBeenCalled();
  });
});
