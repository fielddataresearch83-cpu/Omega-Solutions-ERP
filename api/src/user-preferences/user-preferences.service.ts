import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

const DEFAULT_DATE_FORMAT = 'DD MMM YYYY';

@Injectable()
export class UserPreferencesService {
  constructor(private readonly db: DatabaseService) {}

  async getDisplay(user: AuthenticatedUser) {
    if (!user.companyId) throw new BadRequestException('Select a company before loading display preferences.');
    const result = await this.db.query<{ date_format: string }>(
      `SELECT udp.date_format
       FROM user_display_preferences udp
       JOIN company_memberships cm ON cm.user_id = udp.user_id AND cm.company_id = udp.company_id AND cm.is_active = true
       JOIN companies c ON c.id = udp.company_id AND c.is_active = true
       WHERE udp.user_id = $1 AND udp.company_id = $2 LIMIT 1`,
      [user.userId, user.companyId],
    );
    return { dateFormat: result.rows[0]?.date_format ?? DEFAULT_DATE_FORMAT };
  }

  async updateDisplay(user: AuthenticatedUser, dateFormat: string) {
    if (!user.companyId) throw new BadRequestException('Select a company before saving display preferences.');
    const result = await this.db.query(
      `INSERT INTO user_display_preferences (user_id, company_id, date_format)
       SELECT $1, $2, $3
       WHERE EXISTS (
         SELECT 1 FROM company_memberships cm
         JOIN companies c ON c.id = cm.company_id
         WHERE cm.user_id = $1 AND cm.company_id = $2
           AND cm.is_active = true AND c.is_active = true
       )
       ON CONFLICT (user_id, company_id)
       DO UPDATE SET date_format = EXCLUDED.date_format, updated_at = NOW()
       RETURNING date_format`,
      [user.userId, user.companyId, dateFormat],
    );
    if (!result.rows.length) throw new ForbiddenException('An active company membership is required to save preferences.');
    return { success: true, dateFormat: result.rows[0].date_format };
  }
}
