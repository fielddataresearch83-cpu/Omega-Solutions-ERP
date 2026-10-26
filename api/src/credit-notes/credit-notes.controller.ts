import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { CreditNotesService } from './credit-notes.service.js';
import { CreateCreditNoteDto, RefundCustomerCreditDto } from './dto/credit-note.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import { RequireModule } from '../subscriptions/require-module.decorator.js';
import { ModuleEntitlementsGuard } from '../subscriptions/module-entitlements.guard.js';

@Controller('credit-notes')
@RequireModule('sales')
@UseGuards(JwtAuthGuard, PermissionsGuard, ModuleEntitlementsGuard)
export class CreditNotesController {
  constructor(private readonly creditNotes: CreditNotesService) {}

  @Get()
  @RequirePermissions('credit-notes:read')
  list(@Req() req: { user: AuthenticatedUser }) {
    return this.creditNotes.list(req.user);
  }

  @Get(':id')
  @RequirePermissions('credit-notes:read')
  getById(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string) {
    return this.creditNotes.getById(req.user, id);
  }

  @Post()
  @RequirePermissions('credit-notes:write')
  create(@Req() req: { user: AuthenticatedUser }, @Body() dto: CreateCreditNoteDto) {
    return this.creditNotes.create(req.user, dto);
  }

  @Post(':id/refunds')
  @RequirePermissions('credit-notes:write')
  recordRefund(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Body() dto: RefundCustomerCreditDto) {
    return this.creditNotes.recordRefund(req.user, id, dto);
  }
}
