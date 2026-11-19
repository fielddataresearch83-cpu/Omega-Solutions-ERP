import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { UsersRolesService } from './users-roles.service.js';
import { InvitationsService } from './invitations.service.js';
import { AcceptInvitationDto, CreateInvitationDto } from './dto/invitations.dto.js';
import { UpdateMembershipRoleDto } from './dto/update-membership-role.dto.js';
import { UpdateMembershipStatusDto } from './dto/update-membership-status.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

@Controller('users-roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersRolesController {
  constructor(
    private readonly service: UsersRolesService,
    private readonly invitations: InvitationsService,
  ) {}

  @Get()
  @RequirePermissions('users:read')
  list(@Req() req: { user: AuthenticatedUser }) {
    return this.service.list(req.user);
  }

  @Get('roles')
  @RequirePermissions('users:read')
  roles(@Req() req: { user: AuthenticatedUser }) {
    return this.service.roleCatalog(req.user);
  }

  @Get('invitations')
  @RequirePermissions('users:read')
  listInvitations(@Req() req: { user: AuthenticatedUser }) {
    return this.invitations.list(req.user);
  }

  @Post('invitations')
  @RequirePermissions('users:write')
  createInvitation(@Req() req: { user: AuthenticatedUser }, @Body() dto: CreateInvitationDto) {
    return this.invitations.create(req.user, dto);
  }

  @Post('invitations/:invitationId/revoke')
  @RequirePermissions('users:write')
  revokeInvitation(
    @Req() req: { user: AuthenticatedUser },
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitations.revoke(req.user, invitationId);
  }

  @Post('invitations/accept')
  acceptInvitation(@Req() req: { user: AuthenticatedUser }, @Body() dto: AcceptInvitationDto) {
    return this.invitations.accept(req.user, dto.token);
  }

  @Patch(':membershipId/status')
  @RequirePermissions('users:write')
  setMembershipStatus(
    @Req() req: { user: AuthenticatedUser },
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: UpdateMembershipStatusDto,
  ) {
    return this.service.setMembershipStatus(req.user, membershipId, dto.isActive);
  }

  @Patch(':membershipId/role')
  @RequirePermissions('users:write')
  updateRole(
    @Req() req: { user: AuthenticatedUser },
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: UpdateMembershipRoleDto,
  ) {
    return this.service.updateRole(req.user, membershipId, dto);
  }
}
