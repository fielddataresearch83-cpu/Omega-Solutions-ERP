import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ProjectEventReminderController } from './project-event-reminder.controller.js';

describe('ProjectEventReminderController', () => {
  const secret = 'test-only-cron-secret-that-is-at-least-32-chars';
  let previousSecret: string | undefined;
  let projects: { dispatchEventReminders: ReturnType<typeof vi.fn> };
  let controller: ProjectEventReminderController;

  beforeEach(() => {
    previousSecret = process.env.PROJECT_EVENT_REMINDER_CRON_SECRET;
    process.env.PROJECT_EVENT_REMINDER_CRON_SECRET = secret;
    projects = { dispatchEventReminders: vi.fn().mockResolvedValue({ delivered: 3 }) };
    controller = new ProjectEventReminderController(projects as never);
  });

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.PROJECT_EVENT_REMINDER_CRON_SECRET;
    else process.env.PROJECT_EVENT_REMINDER_CRON_SECRET = previousSecret;
  });

  it('refuses dispatch when the scheduler secret is not configured', () => {
    delete process.env.PROJECT_EVENT_REMINDER_CRON_SECRET;
    expect(() => controller.dispatch(secret)).toThrow(ServiceUnavailableException);
    expect(projects.dispatchEventReminders).not.toHaveBeenCalled();
  });

  it('rejects missing or incorrect scheduler credentials', () => {
    expect(() => controller.dispatch()).toThrow(UnauthorizedException);
    expect(() => controller.dispatch('wrong-secret')).toThrow(UnauthorizedException);
    expect(projects.dispatchEventReminders).not.toHaveBeenCalled();
  });

  it('dispatches only after a timing-safe secret match', async () => {
    await expect(controller.dispatch(secret)).resolves.toEqual({ delivered: 3 });
    expect(projects.dispatchEventReminders).toHaveBeenCalledOnce();
  });
});
