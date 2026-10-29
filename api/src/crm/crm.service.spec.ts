import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CrmService } from './crm.service.js';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

describe('CrmService', () => {
  const user: AuthenticatedUser = {
    userId: 'user-1', email: 'owner@example.test', fullName: 'Test Owner',
    companyId: 'company-1', branchId: null, role: 'owner', permissions: ['crm:read','crm:write'],
  };
  let db: { query: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> };
  let memberships: { getMembership: ReturnType<typeof vi.fn>; getMembershipForCompany: ReturnType<typeof vi.fn> };
  let audit: { log: ReturnType<typeof vi.fn> };
  let service: CrmService;

  beforeEach(() => {
    db = { query: vi.fn(), transaction: vi.fn() };
    const membership = { companyId: 'company-1', branchId: null, role: 'owner' };
    memberships = {
      getMembership: vi.fn().mockResolvedValue(membership),
      getMembershipForCompany: vi.fn().mockResolvedValue(membership),
    };
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    service = new CrmService(
      db as unknown as DatabaseService,
      memberships as unknown as MembershipsService,
      audit as unknown as AuditService,
    );
  });

  it('scopes lead listing to the active company and filters by status and search', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'lead-1' }], rowCount: 1 });
    const rows = await service.listLeads(user, 'Acme', 'qualified');
    expect(rows).toEqual([{ id: 'lead-1' }]);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE company_id = $1'),
      ['company-1', 'qualified', '%Acme%', 250, 0],
    );
  });

  it('passes bounded pagination values to the lead query', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'lead-101' }], rowCount: 1 });
    const rows = await service.listLeads(user, undefined, undefined, 100, 100);
    expect(rows).toEqual([{ id: 'lead-101' }]);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY created_at DESC LIMIT $4 OFFSET $5'),
      ['company-1', null, null, 100, 100],
    );
  });

  it('rejects invalid pagination limits before querying the database', async () => {
    await expect(service.listLeads(user, undefined, undefined, 251, 0)).rejects.toThrow(BadRequestException);
    await expect(service.listLeads(user, undefined, undefined, 10, -1)).rejects.toThrow(BadRequestException);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects a blank lead contact name before creating a record', async () => {
    await expect(service.createLead(user, { contactName: '   ' })).rejects.toThrow('Lead contact name cannot be blank.');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects a blank lead contact name before updating a record', async () => {
    await expect(service.updateLead(user, 'lead-1', { contactName: '   ' })).rejects.toThrow('Lead contact name cannot be blank.');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('uses the active company membership instead of the default membership', async () => {
    memberships.getMembershipForCompany.mockResolvedValue({ companyId: 'company-active', branchId: null, role: 'owner' });
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await service.listLeads(user);
    expect(memberships.getMembershipForCompany).toHaveBeenCalledWith('user-1', 'company-1');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE company_id = $1'),
      ['company-active', null, null, 250, 0],
    );
  });

  it('blocks branch-bound memberships from company-wide CRM records until branch attribution exists', async () => {
    memberships.getMembershipForCompany.mockResolvedValue({ companyId: 'company-1', branchId: 'branch-1', role: 'staff' });
    await expect(service.listLeads(user)).rejects.toThrow('CRM records are company-wide until branch attribution is supported');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('does not return a lead outside the company scope', async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(service.getLead(user, 'other-company-lead')).rejects.toThrow(NotFoundException);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = $1 AND company_id = $2'),
      ['other-company-lead', 'company-1'],
    );
  });

  it('requires an opportunity to be linked to a lead or customer', async () => {
    await expect(service.createOpportunity(user, { title: 'Unlinked deal' })).rejects.toThrow('An opportunity must be linked to exactly one lead or customer.');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects opportunities linked to both a lead and a customer', async () => {
    await expect(service.createOpportunity(user, {
      title: 'Ambiguous deal', leadId: 'lead-1', customerId: 'customer-1',
    })).rejects.toThrow('An opportunity must be linked to exactly one lead or customer.');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('requires CRM activities to be linked to a record', async () => {
    await expect(service.createActivity(user, { activityType: 'task', subject: 'Call back' })).rejects.toThrow(BadRequestException);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects activities linked to more than one record', async () => {
    await expect(service.createActivity(user, {
      activityType: 'task', subject: 'Follow up', leadId: 'lead-1', customerId: 'customer-1',
    })).rejects.toThrow('Link the activity to exactly one lead, opportunity or customer.');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects support tickets linked to both a customer and a lead', async () => {
    await expect(service.createTicket(user, {
      subject: 'Support request', customerId: 'customer-1', leadId: 'lead-1',
    })).rejects.toThrow('Link the ticket to exactly one customer or lead.');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('requires support tickets to be linked to a customer or lead', async () => {
    await expect(service.createTicket(user, { subject: 'Unlinked ticket' }))
      .rejects.toThrow('Link the ticket to exactly one customer or lead.');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('lists CRM customers within the current company', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'customer-1', name: 'Acme Ltd' }], rowCount: 1 });
    const rows = await service.listCrmCustomers(user, 'Acme');
    expect(rows).toEqual([{ id: 'customer-1', name: 'Acme Ltd' }]);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE company_id=$1'),
      ['company-1', '%Acme%'],
    );
  });

  it('rejects a campaign whose end date is before its start date before querying the database', async () => {
    await expect(service.createCampaign(user, {
      name: 'Invalid date range',
      startDate: '2026-11-10',
      endDate: '2026-11-09',
    })).rejects.toThrow('Campaign end date cannot be before its start date.');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects an update that makes a campaign end before its existing start date', async () => {
    db.query.mockResolvedValue({ rows: [{ start_date: '2026-11-10', end_date: '2026-11-20' }], rowCount: 1 });
    await expect(service.updateCampaign(user, 'campaign-1', { endDate: '2026-11-09' }))
      .rejects.toThrow('Campaign end date cannot be before its start date.');
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query).toHaveBeenCalledWith(
      'SELECT start_date, end_date FROM crm_campaigns WHERE id=$1 AND company_id=$2',
      ['campaign-1', 'company-1'],
    );
  });

  it('does not update a campaign outside the active company', async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(service.updateCampaign(user, 'foreign-campaign', { status: 'paused' }))
      .rejects.toThrow(NotFoundException);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query).toHaveBeenCalledWith(
      'SELECT start_date, end_date FROM crm_campaigns WHERE id=$1 AND company_id=$2',
      ['foreign-campaign', 'company-1'],
    );
  });

  it('scopes CRM support ticket listing to the active company', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'ticket-1' }], rowCount: 1 });
    const rows = await service.listTickets(user, 'open', 'urgent', 'printer');
    expect(rows).toEqual([{ id: 'ticket-1' }]);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE t.company_id=$1'),
      ['company-1', 'open', 'urgent', '%printer%'],
    );
  });
  it('only exposes ticket assignee names through an active membership in the same company', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'ticket-1', assignee_name: 'Company Staff' }], rowCount: 1 });
    const rows = await service.listTickets(user);
    expect(rows).toEqual([{ id: 'ticket-1', assignee_name: 'Company Staff' }]);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('assigned_membership.company_id=t.company_id AND assigned_membership.is_active=TRUE'),
      ['company-1', null, null, null],
    );
  });

  it('includes company-scoped customer names for customer-linked activities', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'activity-1', customer_name: 'Acme Ltd' }], rowCount: 1 });
    const rows = await service.listActivities(user, { pending: true });
    expect(rows).toEqual([{ id: 'activity-1', customer_name: 'Acme Ltd' }]);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('LEFT JOIN customers c ON c.id=a.customer_id AND c.company_id=a.company_id'),
      ['company-1', null, null, true],
    );
  });


  it('allows explicitly clearing a ticket assignee and due date without changing omitted fields', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'ticket-1', assigned_user_id: null, due_at: null }], rowCount: 1 });

    const result = await service.updateTicket(user, 'ticket-1', {
      assignedUserId: null,
      dueAt: null,
    });

    expect(result).toEqual({ id: 'ticket-1', assigned_user_id: null, due_at: null });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('assigned_user_id=CASE WHEN $8::boolean THEN $5::uuid ELSE assigned_user_id END'),
      ['ticket-1', 'company-1', null, null, null, null, null, true, true],
    );
    expect(audit.log).toHaveBeenCalled();
  });

});
