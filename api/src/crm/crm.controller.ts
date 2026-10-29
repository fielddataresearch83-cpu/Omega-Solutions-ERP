import { Controller, Get, Post, Patch, Body, Param, Query, Request, UseGuards } from '@nestjs/common';
import { CrmService } from './crm.service.js';
import {
  AddCampaignLeadDto, AddCampaignSegmentDto, AddSegmentMemberDto, CreateActivityDto, CreateCampaignDto, CreateLeadDto,
  CreateOpportunityDto, CreateSegmentDto, CreateTicketDto, UpdateActivityDto, UpdateCampaignDto, UpdateCampaignLeadDto,
  UpdateLeadDto, UpdateOpportunityDto, UpdateTicketDto,
} from './dto/crm.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import { RequireModule } from '../subscriptions/require-module.decorator.js';
import { ModuleEntitlementsGuard } from '../subscriptions/module-entitlements.guard.js';

@Controller('crm')
@RequireModule('crm')
@UseGuards(JwtAuthGuard, PermissionsGuard, ModuleEntitlementsGuard)
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Get('campaigns') @RequirePermissions('crm:read')
  listCampaigns(@Request() req: { user: AuthenticatedUser }, @Query('status') status?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.crm.listCampaigns(req.user, status, limit === undefined ? 200 : Number(limit), offset === undefined ? 0 : Number(offset));
  }

  @Post('campaigns') @RequirePermissions('crm:write')
  createCampaign(@Request() req: { user: AuthenticatedUser }, @Body() dto: CreateCampaignDto) {
    return this.crm.createCampaign(req.user, dto);
  }

  @Patch('campaigns/:id') @RequirePermissions('crm:write')
  updateCampaign(@Request() req: { user: AuthenticatedUser }, @Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    return this.crm.updateCampaign(req.user, id, dto);
  }

  @Post('campaigns/:campaignId/leads') @RequirePermissions('crm:write')
  addCampaignLead(@Request() req: { user: AuthenticatedUser }, @Param('campaignId') campaignId: string, @Body() dto: AddCampaignLeadDto) {
    return this.crm.addCampaignLead(req.user, campaignId, dto);
  }

  @Get('campaigns/:campaignId/leads') @RequirePermissions('crm:read')
  listCampaignLeads(@Request() req: { user: AuthenticatedUser }, @Param('campaignId') campaignId: string) {
    return this.crm.listCampaignLeads(req.user, campaignId);
  }

  @Patch('campaigns/:campaignId/leads/:leadId') @RequirePermissions('crm:write')
  updateCampaignLead(@Request() req: { user: AuthenticatedUser }, @Param('campaignId') campaignId: string, @Param('leadId') leadId: string, @Body() dto: UpdateCampaignLeadDto) {
    return this.crm.updateCampaignLead(req.user, campaignId, leadId, dto);
  }

  @Post('campaigns/:campaignId/segments') @RequirePermissions('crm:write')
  addCampaignSegment(@Request() req: { user: AuthenticatedUser }, @Param('campaignId') campaignId: string, @Body() dto: AddCampaignSegmentDto) {
    return this.crm.addCampaignSegment(req.user, campaignId, dto);
  }

  @Get('segments') @RequirePermissions('crm:read')
  listSegments(@Request() req: { user: AuthenticatedUser }) {
    return this.crm.listSegments(req.user);
  }

  @Post('segments') @RequirePermissions('crm:write')
  createSegment(@Request() req: { user: AuthenticatedUser }, @Body() dto: CreateSegmentDto) {
    return this.crm.createSegment(req.user, dto);
  }

  @Post('segments/:segmentId/members') @RequirePermissions('crm:write')
  addSegmentMember(@Request() req: { user: AuthenticatedUser }, @Param('segmentId') segmentId: string, @Body() dto: AddSegmentMemberDto) {
    return this.crm.addSegmentMember(req.user, segmentId, dto);
  }

  @Get('tickets') @RequirePermissions('crm:read')
  listTickets(@Request() req: { user: AuthenticatedUser }, @Query('status') status?: string, @Query('priority') priority?: string, @Query('search') search?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.crm.listTickets(req.user, status, priority, search, limit === undefined ? 250 : Number(limit), offset === undefined ? 0 : Number(offset));
  }

  @Post('tickets') @RequirePermissions('crm:write')
  createTicket(@Request() req: { user: AuthenticatedUser }, @Body() dto: CreateTicketDto) {
    return this.crm.createTicket(req.user, dto);
  }

  @Patch('tickets/:id') @RequirePermissions('crm:write')
  updateTicket(@Request() req: { user: AuthenticatedUser }, @Param('id') id: string, @Body() dto: UpdateTicketDto) {
    return this.crm.updateTicket(req.user, id, dto);
  }

  @Get('pipeline') @RequirePermissions('crm:read')
  pipeline(@Request() req: { user: AuthenticatedUser }) { return this.crm.pipelineSummary(req.user); }

  @Get('customers') @RequirePermissions('crm:read')
  listCrmCustomers(@Request() req: { user: AuthenticatedUser }, @Query('search') search?: string) {
    return this.crm.listCrmCustomers(req.user, search);
  }

  @Get('leads') @RequirePermissions('crm:read')
  list(@Request() req: { user: AuthenticatedUser }, @Query('search') search?: string, @Query('status') status?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.crm.listLeads(req.user, search, status, limit === undefined ? 250 : Number(limit), offset === undefined ? 0 : Number(offset));
  }

  @Get('leads/:leadId') @RequirePermissions('crm:read')
  get(@Request() req: { user: AuthenticatedUser }, @Param('leadId') leadId: string) {
    return this.crm.getLead(req.user, leadId);
  }

  @Post('leads') @RequirePermissions('crm:write')
  create(@Request() req: { user: AuthenticatedUser }, @Body() dto: CreateLeadDto) {
    return this.crm.createLead(req.user, dto);
  }

  @Patch('leads/:leadId') @RequirePermissions('crm:write')
  update(@Request() req: { user: AuthenticatedUser }, @Param('leadId') leadId: string, @Body() dto: UpdateLeadDto) {
    return this.crm.updateLead(req.user, leadId, dto);
  }

  @Post('leads/:leadId/convert') @RequirePermissions('crm:write')
  convertLead(@Request() req: { user: AuthenticatedUser }, @Param('leadId') leadId: string) {
    return this.crm.convertLeadToCustomer(req.user, leadId);
  }

  @Get('opportunities') @RequirePermissions('crm:read')
  listOpportunities(@Request() req: { user: AuthenticatedUser }, @Query('stage') stage?: string, @Query('search') search?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.crm.listOpportunities(req.user, stage, search, limit === undefined ? 250 : Number(limit), offset === undefined ? 0 : Number(offset));
  }

  @Post('opportunities') @RequirePermissions('crm:write')
  createOpportunity(@Request() req: { user: AuthenticatedUser }, @Body() dto: CreateOpportunityDto) {
    return this.crm.createOpportunity(req.user, dto);
  }

  @Get('opportunities/:id') @RequirePermissions('crm:read')
  getOpportunity(@Request() req: { user: AuthenticatedUser }, @Param('id') id: string) {
    return this.crm.getOpportunity(req.user, id);
  }

  @Patch('opportunities/:id') @RequirePermissions('crm:write')
  updateOpportunity(@Request() req: { user: AuthenticatedUser }, @Param('id') id: string, @Body() dto: UpdateOpportunityDto) {
    return this.crm.updateOpportunity(req.user, id, dto);
  }

  @Get('activities') @RequirePermissions('crm:read')
  listActivities(
    @Request() req: { user: AuthenticatedUser },
    @Query('leadId') leadId?: string,
    @Query('opportunityId') opportunityId?: string,
    @Query('pending') pending?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.crm.listActivities(req.user, { leadId, opportunityId, pending: pending === 'true', limit: limit === undefined ? 250 : Number(limit), offset: offset === undefined ? 0 : Number(offset) });
  }

  @Post('activities') @RequirePermissions('crm:write')
  createActivity(@Request() req: { user: AuthenticatedUser }, @Body() dto: CreateActivityDto) {
    return this.crm.createActivity(req.user, dto);
  }

  @Patch('activities/:id') @RequirePermissions('crm:write')
  completeActivity(@Request() req: { user: AuthenticatedUser }, @Param('id') id: string, @Body() dto: UpdateActivityDto) {
    return this.crm.completeActivity(req.user, id, dto);
  }
}
