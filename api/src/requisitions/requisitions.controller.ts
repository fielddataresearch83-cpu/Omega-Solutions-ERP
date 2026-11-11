import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { RequisitionsService } from './requisitions.service.js';
import { CreateRequisitionDto, UpdateRequisitionDto } from './dto/requisition.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import { RequireModule } from '../subscriptions/require-module.decorator.js';
import { ModuleEntitlementsGuard } from '../subscriptions/module-entitlements.guard.js';

@Controller('requisitions')
@RequireModule('procurement')
@UseGuards(JwtAuthGuard, PermissionsGuard, ModuleEntitlementsGuard)
export class RequisitionsController {
  constructor(private readonly service: RequisitionsService) {}
  @Get() @RequirePermissions('requisitions:read') list(@Req() req:{user:AuthenticatedUser}) { return this.service.list(req.user); }
  @Get(':id') @RequirePermissions('requisitions:read') get(@Req() req:{user:AuthenticatedUser}, @Param('id',ParseUUIDPipe) id:string) { return this.service.get(req.user,id); }
  @Post() @RequirePermissions('requisitions:write') create(@Req() req:{user:AuthenticatedUser}, @Body() dto:CreateRequisitionDto) { return this.service.create(req.user,dto); }
  @Patch(':id') @RequirePermissions('requisitions:write') update(@Req() req:{user:AuthenticatedUser}, @Param('id',ParseUUIDPipe) id:string, @Body() dto:UpdateRequisitionDto) { return this.service.update(req.user,id,dto); }
  @Post(':id/submit') @RequirePermissions('requisitions:write') submit(@Req() req:{user:AuthenticatedUser}, @Param('id',ParseUUIDPipe) id:string) { return this.service.submit(req.user,id); }
}
