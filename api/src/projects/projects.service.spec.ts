import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import { ProjectsService } from './projects.service.js';

const user: AuthenticatedUser = {
  userId: 'user-1',
  email: 'owner@example.test',
  fullName: 'Company Owner',
  companyId: 'company-1',
  branchId: null,
  role: 'owner',
  permissions: ['projects:read', 'projects:write'],
};

describe('ProjectsService', () => {
  let service: ProjectsService;
  let db: { query: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> };
  let memberships: { getMembershipForCompany: ReturnType<typeof vi.fn>; getMembership: ReturnType<typeof vi.fn> };
  let audit: { logInTransaction: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    db = { query: vi.fn(), transaction: vi.fn() };
    memberships = { getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null, role: 'owner' }), getMembership: vi.fn() };
    audit = { logInTransaction: vi.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: DatabaseService, useValue: db },
        { provide: MembershipsService, useValue: memberships },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get(ProjectsService);
  });

  it('lists only the selected company projects', async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await service.listProjects(user);

    expect(memberships.getMembershipForCompany).toHaveBeenCalledWith('user-1', 'company-1');
    expect(db.query.mock.calls[0][0]).toContain('WHERE p.company_id=$1');
    expect(db.query.mock.calls[0][1]).toEqual(['company-1']);
  });

  it('lists only active members of the selected company for assignment', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'user-1', full_name: 'Company Owner', email: 'owner@example.test', role: 'owner' }], rowCount: 1 });

    const result = await service.listMembers(user);

    expect(result).toHaveLength(1);
    expect(db.query.mock.calls[0][0]).toContain('cm.company_id = $1 AND cm.is_active = true');
    expect(db.query.mock.calls[0][1]).toEqual(['company-1']);
  });

  it('rejects assigning a task to a project outside the active company', async () => {
    const client = {
      query: vi.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 }),
    };
    db.transaction.mockImplementation(async (callback) => callback(client));

    await expect(service.createTask(user, {
      title: 'Cross-tenant task',
      projectId: 'project-from-another-company',
    })).rejects.toThrow(BadRequestException);

    expect(client.query.mock.calls[0][1]).toEqual(['project-from-another-company', 'company-1']);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(audit.logInTransaction).not.toHaveBeenCalled();
  });

  it('validates a task assignee against active membership in the same company', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
    };
    db.transaction.mockImplementation(async (callback) => callback(client));

    await expect(service.createTask(user, {
      title: 'Invalid assignee task',
      assignedTo: 'user-from-another-company',
    })).rejects.toThrow('Assignee must be an active member of this company.');

    expect(client.query.mock.calls[1][1]).toEqual(['user-from-another-company', 'company-1']);
    expect(audit.logInTransaction).not.toHaveBeenCalled();
  });
  it('persists calendar attendees and reminder preferences in the audited transaction', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'event-1' }], rowCount: 1 }),
    };
    db.transaction.mockImplementation(async (callback) => callback(client));

    await service.createEvent(user, {
      title: 'Project kickoff',
      startAt: '2026-11-13T09:00:00.000Z',
      attendees: ['ops@example.test', 'finance@example.test'],
      reminderEnabled: false,
    });

    expect(client.query.mock.calls[0][0]).toContain('attendees,reminder_enabled,created_by');
    expect(client.query.mock.calls[0][1]).toContain(JSON.stringify(['ops@example.test', 'finance@example.test']));
    expect(client.query.mock.calls[0][1]).toContain(false);
    expect(audit.logInTransaction).toHaveBeenCalledWith(client, expect.objectContaining({
      action: 'projects.event.create',
      entityId: 'event-1',
    }));
  });

  it('validates project ownership against active membership before inserting', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
    };
    db.transaction.mockImplementation(async (callback) => callback(client));

    await expect(service.createProject(user, {
      name: 'Cross-company project',
      ownerUserId: 'user-from-another-company',
    })).rejects.toThrow('Project owner must be an active member of this company.');

    expect(client.query.mock.calls[0][1]).toEqual(['user-from-another-company', 'company-1']);
    expect(audit.logInTransaction).not.toHaveBeenCalled();
  });

});
