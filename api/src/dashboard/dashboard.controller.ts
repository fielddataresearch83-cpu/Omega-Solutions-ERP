import { Controller, Get, Request, UnauthorizedException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  summary(@Request() req: { user: AuthenticatedUser }) {
    if (!req.user.companyId) throw new UnauthorizedException('Select a company before viewing dashboard metrics.');
    return this.dashboard.summary(req.user);
  }
}
