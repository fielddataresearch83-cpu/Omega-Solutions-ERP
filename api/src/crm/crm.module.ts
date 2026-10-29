import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller.js';
import { CrmReminderController } from './crm-reminder.controller.js';
import { CrmService } from './crm.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { MembershipsModule } from '../memberships/memberships.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [DatabaseModule, MembershipsModule, AuditModule, RbacModule, AuthModule],
  controllers: [CrmController, CrmReminderController],
  providers: [CrmService],
})
export class CrmModule {}
