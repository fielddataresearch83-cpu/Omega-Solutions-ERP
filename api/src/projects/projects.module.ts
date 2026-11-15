import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller.js';
import { ProjectEventReminderController } from './project-event-reminder.controller.js';
import { ProjectsService } from './projects.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { MembershipsModule } from '../memberships/memberships.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [DatabaseModule, MembershipsModule, AuditModule, RbacModule, AuthModule],
  controllers: [ProjectsController, ProjectEventReminderController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
