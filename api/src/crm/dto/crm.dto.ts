import { IsBoolean, IsDateString, IsEmail, IsIn, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateLeadDto {
  @IsString() @MinLength(2) @MaxLength(180) contactName!: string;
  @IsOptional() @IsString() @MaxLength(180) organizationName?: string;
  @IsOptional() @IsEmail() @MaxLength(320) email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(60) source?: string;
  @IsOptional() @IsNumber() @Min(0) estimatedValue?: number;
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
  @IsOptional() @IsString() notes?: string;
}
export class UpdateLeadDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(180) contactName?: string;
  @IsOptional() @IsString() @MaxLength(180) organizationName?: string;
  @IsOptional() @IsEmail() @MaxLength(320) email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(60) source?: string;
  @IsOptional() @IsIn(['new','qualified','unqualified']) status?: 'new'|'qualified'|'unqualified';
  @IsOptional() @IsNumber() @Min(0) estimatedValue?: number;
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
  @IsOptional() @IsString() notes?: string;
}

export class CreateOpportunityDto {
  @IsString() @MinLength(2) @MaxLength(180) title!: string;
  @IsOptional() @IsUUID() leadId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsNumber() @Min(0) expectedValue?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) probability?: number;
  @IsOptional() @IsIn(['qualification','needs_analysis','proposal','negotiation','won','lost']) stage?: 'qualification'|'needs_analysis'|'proposal'|'negotiation'|'won'|'lost';
  @IsOptional() @IsDateString() expectedCloseDate?: string;
  @IsOptional() @IsString() lossReason?: string;
}
export class UpdateOpportunityDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(180) title?: string;
  @IsOptional() @IsNumber() @Min(0) expectedValue?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) probability?: number;
  @IsOptional() @IsIn(['qualification','needs_analysis','proposal','negotiation','won','lost']) stage?: 'qualification'|'needs_analysis'|'proposal'|'negotiation'|'won'|'lost';
  @IsOptional() @IsDateString() expectedCloseDate?: string;
  @IsOptional() @IsString() lossReason?: string;
}
export class CreateActivityDto {
  @IsString() @IsIn(['call','email','meeting','task','note']) activityType!: 'call'|'email'|'meeting'|'task'|'note';
  @IsString() @MinLength(2) @MaxLength(180) subject!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsUUID() leadId?: string;
  @IsOptional() @IsUUID() opportunityId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() assignedUserId?: string;
  @IsOptional() @IsDateString() dueAt?: string;
}
export class UpdateActivityDto {
  @IsOptional() @IsBoolean() completed?: boolean;
}

export class CreateCampaignDto {
  @IsString() @MinLength(2) @MaxLength(180) name!: string;
  @IsOptional() @IsIn(['email','phone','event','social','referral','other']) campaignType?: 'email'|'phone'|'event'|'social'|'referral'|'other';
  @IsOptional() @IsIn(['planned','active','paused','completed','cancelled']) status?: 'planned'|'active'|'paused'|'completed'|'cancelled';
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsNumber() @Min(0) budget?: number;
  @IsOptional() @IsNumber() @Min(0) actualCost?: number;
  @IsOptional() @IsNumber() @Min(0) targetLeads?: number;
  @IsOptional() @IsString() notes?: string;
}
export class UpdateCampaignDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(180) name?: string;
  @IsOptional() @IsIn(['email','phone','event','social','referral','other']) campaignType?: 'email'|'phone'|'event'|'social'|'referral'|'other';
  @IsOptional() @IsIn(['planned','active','paused','completed','cancelled']) status?: 'planned'|'active'|'paused'|'completed'|'cancelled';
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsNumber() @Min(0) budget?: number;
  @IsOptional() @IsNumber() @Min(0) actualCost?: number;
  @IsOptional() @IsNumber() @Min(0) targetLeads?: number;
  @IsOptional() @IsString() notes?: string;
}
export class CreateSegmentDto {
  @IsString() @MinLength(2) @MaxLength(180) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsObject() criteria?: Record<string, unknown>;
  @IsOptional() @IsBoolean() isDynamic?: boolean;
}
export class AddSegmentMemberDto {
  @IsOptional() @IsUUID() leadId?: string;
  @IsOptional() @IsUUID() customerId?: string;
}
export class AddCampaignLeadDto {
  @IsUUID() leadId!: string;
  @IsOptional() @IsIn(['targeted','contacted','responded','converted','unresponsive']) responseStatus?: 'targeted'|'contacted'|'responded'|'converted'|'unresponsive';
}
export class CreateTicketDto {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() leadId?: string;
  @IsString() @MinLength(2) @MaxLength(180) subject!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(['open','in_progress','waiting_customer','resolved','closed']) status?: 'open'|'in_progress'|'waiting_customer'|'resolved'|'closed';
  @IsOptional() @IsIn(['low','normal','high','urgent']) priority?: 'low'|'normal'|'high'|'urgent';
  @IsOptional() @IsUUID() assignedUserId?: string;
  @IsOptional() @IsDateString() dueAt?: string;
}
export class UpdateTicketDto {
  @IsOptional() @IsIn(['open','in_progress','waiting_customer','resolved','closed']) status?: 'open'|'in_progress'|'waiting_customer'|'resolved'|'closed';
  @IsOptional() @IsIn(['low','normal','high','urgent']) priority?: 'low'|'normal'|'high'|'urgent';
  @IsOptional() @IsUUID() assignedUserId?: string | null;
  @IsOptional() @IsDateString() dueAt?: string | null;
  @IsOptional() @IsString() description?: string;
}

export class AddCampaignSegmentDto {
  @IsUUID() segmentId!: string;
}

export class UpdateCampaignLeadDto {
  @IsOptional() @IsIn(['targeted','contacted','responded','converted','unresponsive']) responseStatus?: 'targeted'|'contacted'|'responded'|'converted'|'unresponsive';
}
