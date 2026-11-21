import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { verifyGitHubActionsReminderRequest } from '../github-actions-reminder-auth.js';
import { ProjectsService } from './projects.service.js';

@Controller('internal/project-event-reminders')
export class ProjectEventReminderController {
  constructor(private readonly projects: ProjectsService) {}

  @Post('dispatch')
  @HttpCode(HttpStatus.OK)
  async dispatch(@Headers('authorization') authorization?: string) {
    await verifyGitHubActionsReminderRequest(
      authorization,
      'project-event-reminders.yml',
    );
    return this.projects.dispatchEventReminders();
  }
}
