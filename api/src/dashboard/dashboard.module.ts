import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { MembershipsModule } from '../memberships/memberships.module.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  imports: [DatabaseModule, MembershipsModule, SubscriptionsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
