import { timingSafeEqual } from 'node:crypto';
import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ProjectsService } from './projects.service.js';

@Controller('internal/project-event-reminders')
export class ProjectEventReminderController {
  constructor(private readonly projects: ProjectsService) {}

  @Post('dispatch')
  @HttpCode(HttpStatus.OK)
  dispatch(@Headers('x-cron-secret') suppliedSecret?: string) {
    const configuredSecret = process.env.PROJECT_EVENT_REMINDER_CRON_SECRET;
    if (!configuredSecret || configuredSecret.length < 32) {
      throw new ServiceUnavailableException(
        'Project event reminder scheduler is not configured.',
      );
    }

    if (
      typeof suppliedSecret !== 'string' ||
      Buffer.byteLength(suppliedSecret) !== Buffer.byteLength(configuredSecret) ||
      !timingSafeEqual(Buffer.from(suppliedSecret), Buffer.from(configuredSecret))
    ) {
      throw new UnauthorizedException('Invalid scheduler credential.');
    }

    return this.projects.dispatchEventReminders();
  }
}
