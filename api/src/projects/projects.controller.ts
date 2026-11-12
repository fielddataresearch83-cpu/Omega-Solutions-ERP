import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ProjectsService } from './projects.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import { CreateProjectDto, CreateProjectEventDto, CreateProjectTaskDto, UpdateProjectDto, UpdateProjectEventDto, UpdateProjectTaskDto } from './dto/projects.dto.js';

@Controller('projects')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}
  @Get('members') @RequirePermissions('projects:read')
  listMembers(@Req() req:{user:AuthenticatedUser}) { return this.projects.listMembers(req.user); }
  @Get() @RequirePermissions('projects:read')
  listProjects(@Req() req:{user:AuthenticatedUser}) { return this.projects.listProjects(req.user); }
  @Post() @RequirePermissions('projects:write')
  createProject(@Req() req:{user:AuthenticatedUser},@Body() dto:CreateProjectDto){return this.projects.createProject(req.user,dto);}
  @Patch(':id') @RequirePermissions('projects:write')
  updateProject(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string,@Body() dto:UpdateProjectDto){return this.projects.updateProject(req.user,id,dto);}
  @Get('tasks') @RequirePermissions('projects:read')
  listTasks(@Req() req:{user:AuthenticatedUser},@Query('status') status?:string,@Query('projectId') projectId?:string){return this.projects.listTasks(req.user,status,projectId);}
  @Post('tasks') @RequirePermissions('projects:write')
  createTask(@Req() req:{user:AuthenticatedUser},@Body() dto:CreateProjectTaskDto){return this.projects.createTask(req.user,dto);}
  @Patch('tasks/:id') @RequirePermissions('projects:write')
  updateTask(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string,@Body() dto:UpdateProjectTaskDto){return this.projects.updateTask(req.user,id,dto);}
  @Get('events') @RequirePermissions('projects:read')
  listEvents(@Req() req:{user:AuthenticatedUser},@Query('from') from?:string,@Query('to') to?:string){return this.projects.listEvents(req.user,from,to);}
  @Post('events') @RequirePermissions('projects:write')
  createEvent(@Req() req:{user:AuthenticatedUser},@Body() dto:CreateProjectEventDto){return this.projects.createEvent(req.user,dto);}
  @Patch('events/:id') @RequirePermissions('projects:write')
  updateEvent(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string,@Body() dto:UpdateProjectEventDto){return this.projects.updateEvent(req.user,id,dto);}
}
