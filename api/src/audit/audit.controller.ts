import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

@Controller('audit-logs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit:read')
  list(@Req() req: { user: AuthenticatedUser }, @Query('limit') limit?: string) {
    if (!req.user.companyId) return [];
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 100;
    return this.audit.list(req.user.companyId, Number.isFinite(parsedLimit) ? parsedLimit : 100, req.user.branchId ?? null);
  }
}
