import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  UseGuards,
  Request,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CompaniesService } from './companies.service.js';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

@Controller('companies')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get('me')
  @RequirePermissions('companies:read')
  async getMyCompany(@Request() req: { user: AuthenticatedUser }) {
    return this.companies.getMyCompany(req.user);
  }

  @Get(':companyId')
  @RequirePermissions('companies:read')
  async getById(
    @Request() req: { user: AuthenticatedUser },
    @Param('companyId', ParseUUIDPipe) companyId: string,
  ) {
    return this.companies.getForUser(req.user, companyId);
  }

  @Post()
  @RequirePermissions('companies:write')
  async create(
    @Request() req: { user: AuthenticatedUser },
    @Body() dto: CreateCompanyDto,
  ) {
    return this.companies.create(req.user, dto);
  }

  @Post(':companyId/archive')
  @RequirePermissions('companies:write')
  async archive(
    @Request() req: { user: AuthenticatedUser },
    @Param('companyId', ParseUUIDPipe) companyId: string,
  ) {
    return this.companies.archive(req.user, companyId);
  }

  @Post(':companyId/restore')
  @RequirePermissions('companies:write')
  async restore(
    @Request() req: { user: AuthenticatedUser },
    @Param('companyId', ParseUUIDPipe) companyId: string,
  ) {
    return this.companies.restore(req.user, companyId);
  }

  @Patch(':companyId')
  @RequirePermissions('companies:write')
  async update(
    @Request() req: { user: AuthenticatedUser },
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companies.update(req.user, companyId, dto);
  }
}
