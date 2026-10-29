import { Controller, Headers, HttpCode, Post, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { CrmService } from './crm.service.js';

@Controller('internal/crm-reminders')
export class CrmReminderController {
  constructor(private readonly crm: CrmService) {}

  @Post('dispatch')
  @HttpCode(200)
  dispatch(@Headers('x-omega-cron-secret') suppliedSecret?: string) {
    const expectedSecret = process.env.CRM_REMINDER_CRON_SECRET;
    if (!expectedSecret || expectedSecret.length < 32) {
      throw new ServiceUnavailableException('CRM reminder scheduler is not configured.');
    }
    if (!suppliedSecret || suppliedSecret.length !== expectedSecret.length ||
        !timingSafeEqual(Buffer.from(suppliedSecret), Buffer.from(expectedSecret))) {
      throw new UnauthorizedException('Invalid scheduler credentials.');
    }
    return this.crm.dispatchActivityReminders();
  }
}
