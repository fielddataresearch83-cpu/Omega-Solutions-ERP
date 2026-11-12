import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { PoolClient } from 'pg';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import type { CreateProjectDto, CreateProjectEventDto, CreateProjectTaskDto, UpdateProjectDto, UpdateProjectEventDto, UpdateProjectTaskDto } from './dto/projects.dto.js';

@Injectable()
export class ProjectsService {
  constructor(private readonly db: DatabaseService, private readonly memberships: MembershipsService, private readonly audit: AuditService) {}

  private async scope(user: AuthenticatedUser) {
    return user.companyId
      ? this.memberships.getMembershipForCompany(user.userId, user.companyId)
      : this.memberships.getMembership(user.userId);
  }

  private async ensureProject(companyId: string, projectId: string | undefined, client?: PoolClient) {
    if (!projectId) return;
    const result = client
      ? await client.query('SELECT id FROM projects WHERE id=$1 AND company_id=$2', [projectId, companyId])
      : await this.db.query('SELECT id FROM projects WHERE id=$1 AND company_id=$2', [projectId, companyId]);
    if (!result.rows.length) throw new BadRequestException('The selected project is not available in this company.');
  }

  async listProjects(user: AuthenticatedUser) {
    const { companyId } = await this.scope(user);
    const result = await this.db.query(
      `SELECT p.id,p.company_id,p.name,p.description,p.status,p.priority,p.start_date,p.due_date,p.owner_user_id,
        u.full_name AS owner_name,p.created_at,p.updated_at,
        COUNT(t.id)::int AS task_count,
        COUNT(t.id) FILTER (WHERE t.status='completed')::int AS completed_tasks
       FROM projects p LEFT JOIN users u ON u.id=p.owner_user_id
       LEFT JOIN project_tasks t ON t.project_id=p.id AND t.company_id=p.company_id
       WHERE p.company_id=$1 GROUP BY p.id,u.full_name ORDER BY p.updated_at DESC`, [companyId]);
    return result.rows;
  }

  async createProject(user: AuthenticatedUser, dto: CreateProjectDto) {
    const { companyId } = await this.scope(user);
    return this.db.transaction(async client => {
      if (dto.ownerUserId) {
        const owner = await client.query('SELECT id FROM company_memberships WHERE user_id=$1 AND company_id=$2 AND is_active=true', [dto.ownerUserId, companyId]);
        if (!owner.rows.length) throw new BadRequestException('Project owner must be an active member of this company.');
      }
      const result = await client.query(
        `INSERT INTO projects(company_id,name,description,status,priority,start_date,due_date,owner_user_id,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [companyId,dto.name.trim(),dto.description?.trim()||null,dto.status??'planned',dto.priority??'normal',dto.startDate??null,dto.dueDate??null,dto.ownerUserId??user.userId,user.userId]);
      const row = result.rows[0] as Record<string, unknown>;
      await this.audit.logInTransaction(client,{userId:user.userId,companyId,branchId:null,action:'projects.project.create',entityType:'project',entityId:String(row.id),oldValues:null,newValues:{name:dto.name,status:dto.status??'planned'},ipAddress:null});
      return row;
    });
  }

  async updateProject(user: AuthenticatedUser, id: string, dto: UpdateProjectDto) {
    const { companyId } = await this.scope(user);
    const fields: Record<string,string> = {name:'name',description:'description',status:'status',priority:'priority',startDate:'start_date',dueDate:'due_date',ownerUserId:'owner_user_id'};
    return this.db.transaction(async client => {
      const before = await client.query('SELECT * FROM projects WHERE id=$1 AND company_id=$2 FOR UPDATE',[id,companyId]);
      if (!before.rows.length) throw new NotFoundException('Project not found.');
      if (dto.ownerUserId) {
        const owner = await client.query('SELECT id FROM company_memberships WHERE user_id=$1 AND company_id=$2 AND is_active=true',[dto.ownerUserId,companyId]);
        if (!owner.rows.length) throw new BadRequestException('Project owner must be an active member of this company.');
      }
      const sets:string[]=[]; const values:unknown[]=[];
      for(const key of Object.keys(fields) as Array<keyof UpdateProjectDto>){if(dto[key]!==undefined){values.push(typeof dto[key]==='string'?String(dto[key]).trim():dto[key]);sets.push(fields[key]+'=$'+values.length);}}
      if(!sets.length)return before.rows[0];
      sets.push('updated_at=NOW()'); values.push(id,companyId);
      const result=await client.query(`UPDATE projects SET ${sets.join(',')} WHERE id=$${values.length-1} AND company_id=$${values.length} RETURNING *`,values);
      await this.audit.logInTransaction(client,{userId:user.userId,companyId,branchId:null,action:'projects.project.update',entityType:'project',entityId:id,oldValues:before.rows[0] as Record<string,unknown>,newValues:dto as Record<string,unknown>,ipAddress:null});
      return result.rows[0];
    });
  }

  async listTasks(user: AuthenticatedUser, status?: string, projectId?: string) {
    const {companyId}=await this.scope(user);
    const result=await this.db.query(
      `SELECT t.id,t.company_id,t.project_id,p.name AS project_name,t.title,t.description,t.status,t.category,t.priority,t.assigned_to,
        u.full_name AS assignee_name,t.due_at,t.completed_at,t.created_at,t.updated_at
       FROM project_tasks t LEFT JOIN projects p ON p.id=t.project_id AND p.company_id=t.company_id
       LEFT JOIN users u ON u.id=t.assigned_to
       WHERE t.company_id=$1 AND ($2::text IS NULL OR t.status=$2) AND ($3::uuid IS NULL OR t.project_id=$3)
       ORDER BY t.due_at NULLS LAST,t.created_at DESC LIMIT 250`,[companyId,status&&status!=='all'?status:null,projectId??null]);
    return result.rows;
  }

  async createTask(user: AuthenticatedUser,dto:CreateProjectTaskDto) {
    const {companyId}=await this.scope(user);
    return this.db.transaction(async client=>{
      await this.ensureProject(companyId,dto.projectId,client);
      if(dto.assignedTo){const a=await client.query('SELECT id FROM company_memberships WHERE user_id=$1 AND company_id=$2 AND is_active=true',[dto.assignedTo,companyId]);if(!a.rows.length)throw new BadRequestException('Assignee must be an active member of this company.');}
      const r=await client.query(
        `INSERT INTO project_tasks(company_id,project_id,title,description,status,category,priority,assigned_to,due_at,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [companyId,dto.projectId??null,dto.title.trim(),dto.description?.trim()||null,dto.status??'todo',dto.category??'task',dto.priority??'normal',dto.assignedTo??null,dto.dueAt??null,user.userId]);
      const row=r.rows[0] as Record<string,unknown>;
      await this.audit.logInTransaction(client,{userId:user.userId,companyId,branchId:null,action:'projects.task.create',entityType:'project_task',entityId:String(row.id),oldValues:null,newValues:{title:dto.title,status:dto.status??'todo'},ipAddress:null});
      return row;
    });
  }

  async updateTask(user:AuthenticatedUser,id:string,dto:UpdateProjectTaskDto){
    const {companyId}=await this.scope(user);
    const fields:Record<string,string>={title:'title',description:'description',projectId:'project_id',status:'status',category:'category',priority:'priority',assignedTo:'assigned_to',dueAt:'due_at'};
    return this.db.transaction(async client=>{
      const before=await client.query('SELECT * FROM project_tasks WHERE id=$1 AND company_id=$2 FOR UPDATE',[id,companyId]);
      if(!before.rows.length)throw new NotFoundException('Task not found.');
      if(dto.projectId)await this.ensureProject(companyId,dto.projectId,client);
      if(dto.assignedTo){const a=await client.query('SELECT id FROM company_memberships WHERE user_id=$1 AND company_id=$2 AND is_active=true',[dto.assignedTo,companyId]);if(!a.rows.length)throw new BadRequestException('Assignee must be an active member of this company.');}
      const sets:string[]=[];const values:unknown[]=[];
      for(const key of Object.keys(fields) as Array<keyof UpdateProjectTaskDto>){if(dto[key]!==undefined){values.push(typeof dto[key]==='string'?String(dto[key]).trim():dto[key]);sets.push(fields[key]+'=$'+values.length);}}
      if(dto.status==='completed')sets.push('completed_at=COALESCE(completed_at,NOW())');else if(dto.status)sets.push('completed_at=NULL');
      if(!sets.length)return before.rows[0];
      sets.push('updated_at=NOW()');values.push(id,companyId);
      const r=await client.query(`UPDATE project_tasks SET ${sets.join(',')} WHERE id=$${values.length-1} AND company_id=$${values.length} RETURNING *`,values);
      await this.audit.logInTransaction(client,{userId:user.userId,companyId,branchId:null,action:'projects.task.update',entityType:'project_task',entityId:id,oldValues:before.rows[0] as Record<string,unknown>,newValues:dto as Record<string,unknown>,ipAddress:null});
      return r.rows[0];
    });
  }

  async listEvents(user:AuthenticatedUser,from?:string,to?:string){
    const {companyId}=await this.scope(user);
    if(from&&Number.isNaN(Date.parse(from)))throw new BadRequestException('Invalid start date.');
    if(to&&Number.isNaN(Date.parse(to)))throw new BadRequestException('Invalid end date.');
    const r=await this.db.query(
      `SELECT id,company_id,project_id,title,description,event_type,start_at,end_at,all_day,location,created_by,is_cancelled,created_at,updated_at
       FROM project_events WHERE company_id=$1 AND is_cancelled=false
       AND ($2::timestamptz IS NULL OR start_at >= $2) AND ($3::timestamptz IS NULL OR start_at <= $3)
       ORDER BY start_at ASC LIMIT 500`,[companyId,from??null,to??null]);
    return r.rows;
  }

  async createEvent(user:AuthenticatedUser,dto:CreateProjectEventDto){
    const {companyId}=await this.scope(user);
    return this.db.transaction(async client=>{
      await this.ensureProject(companyId,dto.projectId,client);
      const r=await client.query(
        `INSERT INTO project_events(company_id,project_id,title,description,event_type,start_at,end_at,all_day,location,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [companyId,dto.projectId??null,dto.title.trim(),dto.description?.trim()||null,dto.eventType??'meeting',dto.startAt,dto.endAt??null,dto.allDay??false,dto.location?.trim()||null,user.userId]);
      const row=r.rows[0] as Record<string,unknown>;
      await this.audit.logInTransaction(client,{userId:user.userId,companyId,branchId:null,action:'projects.event.create',entityType:'project_event',entityId:String(row.id),oldValues:null,newValues:{title:dto.title,startAt:dto.startAt},ipAddress:null});
      return row;
    });
  }

  async updateEvent(user:AuthenticatedUser,id:string,dto:UpdateProjectEventDto){
    const {companyId}=await this.scope(user);
    const fields:Record<string,string>={title:'title',description:'description',projectId:'project_id',eventType:'event_type',startAt:'start_at',endAt:'end_at',allDay:'all_day',location:'location',isCancelled:'is_cancelled'};
    return this.db.transaction(async client=>{
      const before=await client.query('SELECT * FROM project_events WHERE id=$1 AND company_id=$2 FOR UPDATE',[id,companyId]);
      if(!before.rows.length)throw new NotFoundException('Calendar event not found.');
      if(dto.projectId)await this.ensureProject(companyId,dto.projectId,client);
      const sets:string[]=[];const values:unknown[]=[];
      for(const key of Object.keys(fields) as Array<keyof UpdateProjectEventDto>){if(dto[key]!==undefined){values.push(typeof dto[key]==='string'?String(dto[key]).trim():dto[key]);sets.push(fields[key]+'=$'+values.length);}}
      if(!sets.length)return before.rows[0];
      sets.push('updated_at=NOW()');values.push(id,companyId);
      const r=await client.query(`UPDATE project_events SET ${sets.join(',')} WHERE id=$${values.length-1} AND company_id=$${values.length} RETURNING *`,values);
      await this.audit.logInTransaction(client,{userId:user.userId,companyId,branchId:null,action:'projects.event.update',entityType:'project_event',entityId:id,oldValues:before.rows[0] as Record<string,unknown>,newValues:dto as Record<string,unknown>,ipAddress:null});
      return r.rows[0];
    });
  }
}
