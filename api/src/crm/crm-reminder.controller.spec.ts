import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { CrmReminderController } from './crm-reminder.controller.js';
import type { CrmService } from './crm.service.js';

describe('CrmReminderController', () => {
  const crm = { dispatchActivityReminders: vi.fn().mockResolvedValue({ delivered: 2 }) };
  let controller: CrmReminderController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CrmReminderController(crm as unknown as CrmService);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses dispatch when the scheduler secret is not configured', () => {
    vi.stubEnv('CRM_REMINDER_CRON_SECRET', '');
    expect(() => controller.dispatch('some-secret')).toThrow(ServiceUnavailableException);
    expect(crm.dispatchActivityReminders).not.toHaveBeenCalled();
  });

  it('rejects an incorrect scheduler secret', () => {
    vi.stubEnv('CRM_REMINDER_CRON_SECRET', 'a'.repeat(40));
    expect(() => controller.dispatch('wrong-secret')).toThrow(UnauthorizedException);
    expect(crm.dispatchActivityReminders).not.toHaveBeenCalled();
  });

  it('dispatches reminders only with the configured scheduler secret', () => {
    const secret = 'safe-development-scheduler-secret-123456';
    vi.stubEnv('CRM_REMINDER_CRON_SECRET', secret);
    expect(controller.dispatch(secret)).toEqual({ delivered: 2 });
    expect(crm.dispatchActivityReminders).toHaveBeenCalledOnce();
  });
});
