import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

const projectStatuses = ['planned','active','on_hold','completed','cancelled'] as const;
const priorities = ['low','normal','high','urgent'] as const;
const taskStatuses = ['pending','todo','in_progress','completed','cancelled'] as const;
const taskCategories = ['task','bug','feature','documentation','improvement','refactor'] as const;
const eventTypes = ['meeting','event','personal','task','reminder'] as const;

export class CreateProjectDto {
  @IsString() @MinLength(2) @MaxLength(180) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(projectStatuses) status?: typeof projectStatuses[number];
  @IsOptional() @IsIn(priorities) priority?: typeof priorities[number];
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsUUID() ownerUserId?: string;
}
export class UpdateProjectDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(180) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(projectStatuses) status?: typeof projectStatuses[number];
  @IsOptional() @IsIn(priorities) priority?: typeof priorities[number];
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsUUID() ownerUserId?: string;
}
export class CreateProjectTaskDto {
  @IsString() @MinLength(2) @MaxLength(200) title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsIn(taskStatuses) status?: typeof taskStatuses[number];
  @IsOptional() @IsIn(taskCategories) category?: typeof taskCategories[number];
  @IsOptional() @IsIn(['low','minor','normal','important','high','critical','urgent']) priority?: string;
  @IsOptional() @IsUUID() assignedTo?: string;
  @IsOptional() @IsDateString() dueAt?: string;
}
export class UpdateProjectTaskDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsIn(taskStatuses) status?: typeof taskStatuses[number];
  @IsOptional() @IsIn(taskCategories) category?: typeof taskCategories[number];
  @IsOptional() @IsIn(['low','minor','normal','important','high','critical','urgent']) priority?: string;
  @IsOptional() @IsUUID() assignedTo?: string | null;
  @IsOptional() @IsDateString() dueAt?: string | null;
}
export class CreateProjectEventDto {
  @IsString() @MinLength(2) @MaxLength(180) title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsIn(eventTypes) eventType?: typeof eventTypes[number];
  @IsDateString() startAt!: string;
  @IsOptional() @IsDateString() endAt?: string;
  @IsOptional() @IsBoolean() allDay?: boolean;
  @IsOptional() @IsString() @MaxLength(240) location?: string;
}
export class UpdateProjectEventDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(180) title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsIn(eventTypes) eventType?: typeof eventTypes[number];
  @IsOptional() @IsDateString() startAt?: string;
  @IsOptional() @IsDateString() endAt?: string | null;
  @IsOptional() @IsBoolean() allDay?: boolean;
  @IsOptional() @IsString() @MaxLength(240) location?: string;
  @IsOptional() @IsBoolean() isCancelled?: boolean;
}
