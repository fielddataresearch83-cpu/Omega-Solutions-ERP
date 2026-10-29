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

  it('keeps opportunity updates routed to updateOpportunity', async () => {
    const crm = {
      updateTicket: vi.fn(),
      updateOpportunity: vi.fn().mockResolvedValue({ id: 'opportunity-1', stage: 'won' }),
    } as unknown as CrmService;
    const controller = new CrmController(crm);

    const result = await controller.updateOpportunity(
      { user },
      'opportunity-1',
      { stage: 'won' },
    );

    expect(result).toEqual({ id: 'opportunity-1', stage: 'won' });
    expect(crm.updateOpportunity).toHaveBeenCalledWith(user, 'opportunity-1', { stage: 'won' });
    expect(crm.updateTicket).not.toHaveBeenCalled();
  });

});
