import { Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { verifyGitHubActionsReminderRequest } from '../github-actions-reminder-auth.js';
import { CrmService } from './crm.service.js';

@Controller('internal/crm-reminders')
export class CrmReminderController {
  constructor(private readonly crm: CrmService) {}

  @Post('dispatch')
  @HttpCode(200)
  async dispatch(@Headers('authorization') authorization?: string) {
    await verifyGitHubActionsReminderRequest(
      authorization,
      'crm-activity-reminders.yml',
    );
    return this.crm.dispatchActivityReminders();
  }
}
