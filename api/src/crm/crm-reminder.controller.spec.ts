import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { verifyGitHubActionsReminderRequest } from '../github-actions-reminder-auth.js';
import { CrmReminderController } from './crm-reminder.controller.js';
import type { CrmService } from './crm.service.js';

vi.mock('../github-actions-reminder-auth.js', () => ({
  verifyGitHubActionsReminderRequest: vi.fn(),
}));

describe('CrmReminderController', () => {
  const crm = { dispatchActivityReminders: vi.fn().mockResolvedValue({ delivered: 2 }) };
  const verifyIdentity = vi.mocked(verifyGitHubActionsReminderRequest);
  let controller: CrmReminderController;

  beforeEach(() => {
    vi.clearAllMocks();
    verifyIdentity.mockResolvedValue(undefined);
    controller = new CrmReminderController(crm as unknown as CrmService);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects an unauthorized GitHub Actions identity', async () => {
    verifyIdentity.mockRejectedValueOnce(new UnauthorizedException());
    await expect(controller.dispatch('Bearer invalid')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(crm.dispatchActivityReminders).not.toHaveBeenCalled();
  });

  it('dispatches reminders only after verifying the CRM workflow identity', async () => {
    expect(await controller.dispatch('Bearer verified-token')).toEqual({ delivered: 2 });
    expect(verifyIdentity).toHaveBeenCalledWith(
      'Bearer verified-token',
      'crm-activity-reminders.yml',
    );
    expect(crm.dispatchActivityReminders).toHaveBeenCalledOnce();
  });
});
