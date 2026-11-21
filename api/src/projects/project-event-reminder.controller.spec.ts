import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { verifyGitHubActionsReminderRequest } from '../github-actions-reminder-auth.js';
import { ProjectEventReminderController } from './project-event-reminder.controller.js';

vi.mock('../github-actions-reminder-auth.js', () => ({
  verifyGitHubActionsReminderRequest: vi.fn(),
}));

describe('ProjectEventReminderController', () => {
  const verifyIdentity = vi.mocked(verifyGitHubActionsReminderRequest);
  let projects: { dispatchEventReminders: ReturnType<typeof vi.fn> };
  let controller: ProjectEventReminderController;

  beforeEach(() => {
    vi.clearAllMocks();
    verifyIdentity.mockResolvedValue(undefined);
    projects = { dispatchEventReminders: vi.fn().mockResolvedValue({ delivered: 3 }) };
    controller = new ProjectEventReminderController(projects as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects an unauthorized GitHub Actions identity', async () => {
    verifyIdentity.mockRejectedValueOnce(new UnauthorizedException());
    await expect(controller.dispatch('Bearer invalid')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(projects.dispatchEventReminders).not.toHaveBeenCalled();
  });

  it('dispatches only after verifying the project event workflow identity', async () => {
    await expect(controller.dispatch('Bearer verified-token')).resolves.toEqual({
      delivered: 3,
    });
    expect(verifyIdentity).toHaveBeenCalledWith(
      'Bearer verified-token',
      'project-event-reminders.yml',
    );
    expect(projects.dispatchEventReminders).toHaveBeenCalledOnce();
  });
});
