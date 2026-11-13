import { Controller, Headers, HttpCode, Post, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { ProjectsService } from './projects.service.js';

@Controller('internal/project-event-reminders')
export class ProjectEventReminderController {
  constructor(private readonly projects: ProjectsService) {}

  @Post('dispatch')
  @HttpCode(200)
  dispatch(@Headers('x-omega-cron-secret') suppliedSecret?: string) {
    const expectedSecret = process.env.PROJECT_EVENT_REMINDER_CRON_SECRET;
    if (!expectedSecret || expectedSecret.length < 32) {
      throw new ServiceUnavailableException('Project event reminder scheduler is not configured.');
    }
    const supplied = Buffer.from(suppliedSecret ?? '');
    const expected = Buffer.from(expectedSecret);
    if (!suppliedSecret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new UnauthorizedException('Invalid scheduler credentials.');
    }
    return this.projects.dispatchEventReminders();
  }
}
