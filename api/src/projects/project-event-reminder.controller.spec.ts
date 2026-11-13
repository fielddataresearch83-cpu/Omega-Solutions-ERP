import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ProjectEventReminderController } from './project-event-reminder.controller.js';
import type { ProjectsService } from './projects.service.js';

describe('ProjectEventReminderController', () => {
  const projects = { dispatchEventReminders: vi.fn().mockResolvedValue({ delivered: 3 }) };
  let controller: ProjectEventReminderController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new ProjectEventReminderController(projects as unknown as ProjectsService);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('refuses dispatch when the scheduler secret is missing or too short', () => {
    vi.stubEnv('PROJECT_EVENT_REMINDER_CRON_SECRET', 'short');
    expect(() => controller.dispatch('short')).toThrow(ServiceUnavailableException);
    expect(projects.dispatchEventReminders).not.toHaveBeenCalled();
  });

  it('rejects an incorrect scheduler secret', () => {
    vi.stubEnv('PROJECT_EVENT_REMINDER_CRON_SECRET', 's'.repeat(40));
    expect(() => controller.dispatch('wrong')).toThrow(UnauthorizedException);
    expect(projects.dispatchEventReminders).not.toHaveBeenCalled();
  });

  it('dispatches with the configured secret', async () => {
    const secret = 'project-event-reminder-development-secret-2026';
    vi.stubEnv('PROJECT_EVENT_REMINDER_CRON_SECRET', secret);
    expect(await controller.dispatch(secret)).toEqual({ delivered: 3 });
    expect(projects.dispatchEventReminders).toHaveBeenCalledOnce();
  });
});
