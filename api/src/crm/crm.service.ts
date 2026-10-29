import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import type {
  AddCampaignLeadDto, AddCampaignSegmentDto, AddSegmentMemberDto, CreateActivityDto, CreateCampaignDto,
  CreateLeadDto, CreateOpportunityDto, CreateSegmentDto, CreateTicketDto, UpdateActivityDto,
  UpdateCampaignDto, UpdateCampaignLeadDto, UpdateLeadDto, UpdateOpportunityDto, UpdateTicketDto,
} from './dto/crm.dto.js';

@Injectable()
export class CrmService {
  constructor(
    private readonly db: DatabaseService,
    private readonly memberships: MembershipsService,
    private readonly audit: AuditService,
  ) {}

  private async membershipFor(user: AuthenticatedUser) {
    const membership = await (user.companyId
      ? this.memberships.getMembershipForCompany(user.userId, user.companyId)
      : this.memberships.getMembership(user.userId));
    if (membership.branchId) {
      throw new ForbiddenException(
        'CRM records are company-wide until branch attribution is supported. A company-wide CRM administrator must perform this action.',
      );
    }
    return membership;
  }

  private async companyId(user: AuthenticatedUser) {
    return (await this.membershipFor(user)).companyId;
  }

  private async auditChange(user: AuthenticatedUser, action: string, entityType: string, entityId: string, newValues: Record<string, unknown>) {
    const membership = await this.membershipFor(user);
    await this.audit.log({
      userId: user.userId, companyId: membership.companyId, branchId: membership.branchId,
      action, entityType, entityId, oldValues: null, newValues, ipAddress: null,
    });
  }

  private listPage(limit: number, offset: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 250) {
      throw new BadRequestException('List limit must be an integer between 1 and 250.');
    }
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000000) {
      throw new BadRequestException('List offset must be a non-negative integer no greater than 1000000.');
    }
    return { limit, offset };
  }

  async listCrmCustomers(user: AuthenticatedUser, search?: string) {
    const companyId = await this.companyId(user);
    const result = await this.db.query('SELECT id, name, email, phone FROM customers WHERE company_id=$1 AND ($2::text IS NULL OR name ILIKE $2 OR email::text ILIKE $2 OR phone ILIKE $2) ORDER BY name ASC LIMIT 250', [companyId, search ? '%' + search + '%' : null]);
    return result.rows;
  }

  async listLeads(user: AuthenticatedUser, search?: string, status?: string, limit = 250, offset = 0) {
    const page = this.listPage(limit, offset);
    const companyId = await this.companyId(user);
    const allowed = ['new', 'qualified', 'unqualified', 'converted'];
    if (status && !allowed.includes(status)) throw new BadRequestException('Invalid lead status.');
    const result = await this.db.query(
      `SELECT id, company_id, owner_user_id, contact_name, organization_name, email, phone, source,
              status, estimated_value, currency, notes, converted_customer_id, created_at, updated_at
       FROM crm_leads WHERE company_id = $1
         AND ($2::text IS NULL OR status = $2)
         AND ($3::text IS NULL OR contact_name ILIKE $3 OR organization_name ILIKE $3 OR email::text ILIKE $3 OR phone ILIKE $3)
       ORDER BY created_at DESC LIMIT $4 OFFSET $5`,
      [companyId, status ?? null, search ? `%${search}%` : null, page.limit, page.offset],
    );
    return result.rows;
  }

  async createLead(user: AuthenticatedUser, dto: CreateLeadDto) {
    if (!dto.contactName.trim()) throw new BadRequestException('Lead contact name cannot be blank.');
    const membership = await this.membershipFor(user);
    const result = await this.db.query(
      `INSERT INTO crm_leads (company_id, owner_user_id, contact_name, organization_name, email, phone, source, estimated_value, currency, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, company_id, owner_user_id, contact_name, organization_name, email, phone, source, status,
                 estimated_value, currency, notes, converted_customer_id, created_at, updated_at`,
      [membership.companyId, user.userId, dto.contactName.trim(), dto.organizationName?.trim() || null,
       dto.email?.trim() || null, dto.phone?.trim() || null, dto.source?.trim() || null,
       dto.estimatedValue ?? 0, (dto.currency ?? 'KES').toUpperCase(), dto.notes?.trim() || null],
    );
    const lead = result.rows[0];
    await this.auditChange(user, 'crm.lead.create', 'crm_lead', String(lead.id), { contactName: dto.contactName, status: 'new' });
    return lead;
  }

  async updateLead(user: AuthenticatedUser, leadId: string, dto: UpdateLeadDto) {
    if (dto.contactName !== undefined && !dto.contactName.trim()) {
      throw new BadRequestException('Lead contact name cannot be blank.');
    }
    const companyId = await this.companyId(user);
    const columns: Record<keyof UpdateLeadDto, string> = {
      contactName: 'contact_name', organizationName: 'organization_name', email: 'email',
      phone: 'phone', source: 'source', status: 'status', estimatedValue: 'estimated_value',
      currency: 'currency', notes: 'notes',
    };
    const values: Array<string | number | null> = [];
    const sets: string[] = [];
    for (const key of Object.keys(columns) as Array<keyof UpdateLeadDto>) {
      if (dto[key] !== undefined) {
        const value = dto[key];
        values.push(typeof value === 'string' && ['contactName','organizationName','email','phone','source','notes'].includes(key) ? (value.trim() || null) : value as string | number);
        sets.push(`${columns[key]} = $${values.length}`);
      }
    }
    if (!sets.length) return this.getLead(user, leadId);
    sets.push('updated_at = NOW()');
    values.push(leadId, companyId);
    const result = await this.db.query(
      `UPDATE crm_leads SET ${sets.join(', ')} WHERE id = $${values.length - 1} AND company_id = $${values.length}
       RETURNING id, company_id, owner_user_id, contact_name, organization_name, email, phone, source, status,
                 estimated_value, currency, notes, converted_customer_id, created_at, updated_at`,
      values,
    );
    if (!result.rows.length) throw new NotFoundException('CRM lead not found.');
    await this.auditChange(user, 'crm.lead.update', 'crm_lead', leadId, { ...dto });
    return result.rows[0];
  }

  async getLead(user: AuthenticatedUser, leadId: string) {
    const companyId = await this.companyId(user);
    const result = await this.db.query(
      `SELECT id, company_id, owner_user_id, contact_name, organization_name, email, phone, source, status,
              estimated_value, currency, notes, converted_customer_id, created_at, updated_at
       FROM crm_leads WHERE id = $1 AND company_id = $2`, [leadId, companyId],
    );
    if (!result.rows.length) throw new NotFoundException('CRM lead not found.');
    return result.rows[0];
  }

  async listOpportunities(user: AuthenticatedUser, stage?: string, search?: string, limit = 250, offset = 0) {
    const page = this.listPage(limit, offset);
    const allowedStages = ['qualification', 'needs_analysis', 'proposal', 'negotiation', 'won', 'lost'];
    if (stage && stage !== 'all' && !allowedStages.includes(stage)) {
      throw new BadRequestException('Invalid opportunity stage.');
    }
    const companyId = await this.companyId(user);
    const result = await this.db.query(
      `SELECT o.*, l.contact_name AS lead_contact_name, c.name AS customer_name,
              ROUND(o.expected_value * o.probability / 100.0, 2) AS weighted_value
       FROM crm_opportunities o
       LEFT JOIN crm_leads l ON l.id=o.lead_id AND l.company_id=o.company_id
       LEFT JOIN customers c ON c.id=o.customer_id AND c.company_id=o.company_id
       WHERE o.company_id=$1 AND ($2::text IS NULL OR o.stage=$2)
         AND ($3::text IS NULL OR o.title ILIKE $3 OR l.contact_name ILIKE $3 OR c.name ILIKE $3)
       ORDER BY o.expected_close_date NULLS LAST, o.created_at DESC LIMIT $4 OFFSET $5`,
      [companyId, stage ?? null, search ? `%${search}%` : null, page.limit, page.offset],
    );
    return result.rows;
  }

  async createOpportunity(user: AuthenticatedUser, dto: CreateOpportunityDto) {
    const membership = await this.membershipFor(user);
    if (Boolean(dto.leadId) === Boolean(dto.customerId)) {
      throw new BadRequestException('An opportunity must be linked to exactly one lead or customer.');
    }
    if (dto.leadId) await this.getLead(user, dto.leadId);
    if (dto.customerId) {
      const customer = await this.db.query('SELECT id FROM customers WHERE id=$1 AND company_id=$2', [dto.customerId, membership.companyId]);
      if (!customer.rows.length) throw new NotFoundException('CRM customer not found.');
    }
    const result = await this.db.query(
      `INSERT INTO crm_opportunities (company_id,lead_id,customer_id,owner_user_id,title,stage,expected_value,probability,expected_close_date,loss_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [membership.companyId, dto.leadId ?? null, dto.customerId ?? null, user.userId, dto.title.trim(),
       dto.stage ?? 'qualification', dto.expectedValue ?? 0, dto.probability ?? 10, dto.expectedCloseDate ?? null, dto.lossReason ?? null],
    );
    const opportunity = result.rows[0];
    await this.auditChange(user, 'crm.opportunity.create', 'crm_opportunity', String(opportunity.id), { title: dto.title, stage: opportunity.stage });
    return opportunity;
  }

  async updateOpportunity(user: AuthenticatedUser, id: string, dto: UpdateOpportunityDto) {
    const companyId = await this.companyId(user);
    const columns: Record<keyof UpdateOpportunityDto, string> = {
      title: 'title', stage: 'stage', expectedValue: 'expected_value', probability: 'probability',
      expectedCloseDate: 'expected_close_date', lossReason: 'loss_reason',
    };
    const values: unknown[] = [];
    const sets: string[] = [];
    for (const key of Object.keys(columns) as Array<keyof UpdateOpportunityDto>) {
      if (dto[key] !== undefined) { values.push(dto[key] ?? null); sets.push(`${columns[key]}=$${values.length}`); }
    }
    if (!sets.length) return this.getOpportunity(user, id);
    sets.push('updated_at=NOW()'); values.push(id, companyId);
    const result = await this.db.query(
      `UPDATE crm_opportunities SET ${sets.join(',')} WHERE id=$${values.length-1} AND company_id=$${values.length} RETURNING *`,
      values as Array<string | number | null>,
    );
    if (!result.rows.length) throw new NotFoundException('CRM opportunity not found.');
    await this.auditChange(user, 'crm.opportunity.update', 'crm_opportunity', id, { ...dto });
    return result.rows[0];
  }

  async getOpportunity(user: AuthenticatedUser, id: string) {
    const companyId = await this.companyId(user);
    const result = await this.db.query('SELECT * FROM crm_opportunities WHERE id=$1 AND company_id=$2', [id, companyId]);
    if (!result.rows.length) throw new NotFoundException('CRM opportunity not found.');
    return result.rows[0];
  }

  async listActivities(user: AuthenticatedUser, options: { leadId?: string; opportunityId?: string; pending?: boolean } = {}) {
    const companyId = await this.companyId(user);
    const result = await this.db.query(
      `SELECT a.*, l.contact_name AS lead_contact_name, o.title AS opportunity_title,
              c.name AS customer_name
       FROM crm_activities a
       LEFT JOIN crm_leads l ON l.id=a.lead_id AND l.company_id=a.company_id
       LEFT JOIN crm_opportunities o ON o.id=a.opportunity_id AND o.company_id=a.company_id
       LEFT JOIN customers c ON c.id=a.customer_id AND c.company_id=a.company_id
       WHERE a.company_id=$1 AND ($2::uuid IS NULL OR a.lead_id=$2)
         AND ($3::uuid IS NULL OR a.opportunity_id=$3)
         AND ($4::boolean IS FALSE OR a.completed_at IS NULL)
       ORDER BY a.due_at NULLS LAST, a.created_at DESC LIMIT 250`,
      [companyId, options.leadId ?? null, options.opportunityId ?? null, options.pending ?? false],
    );
    return result.rows;
  }

  async createActivity(user: AuthenticatedUser, dto: CreateActivityDto) {
    const membership = await this.membershipFor(user);
    const activityLinkCount = [dto.leadId, dto.opportunityId, dto.customerId].filter(Boolean).length;
    if (activityLinkCount !== 1) {
      throw new BadRequestException('Link the activity to exactly one lead, opportunity or customer.');
    }
    if (dto.leadId) await this.getLead(user, dto.leadId);
    if (dto.opportunityId) await this.getOpportunity(user, dto.opportunityId);
    if (dto.customerId) {
      const customer = await this.db.query('SELECT id FROM customers WHERE id=$1 AND company_id=$2', [dto.customerId, membership.companyId]);
      if (!customer.rows.length) throw new NotFoundException('CRM customer not found.');
    }
    const assignedUserId = dto.assignedUserId ?? user.userId;
    const assignedMember = await this.db.query(
      'SELECT user_id FROM company_memberships WHERE user_id=$1 AND company_id=$2 AND is_active=TRUE',
      [assignedUserId, membership.companyId],
    );
    if (!assignedMember.rows.length) throw new BadRequestException('The assigned user must be an active member of this company.');
    const result = await this.db.query(
      `INSERT INTO crm_activities (company_id,lead_id,opportunity_id,customer_id,assigned_user_id,activity_type,subject,description,due_at,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [membership.companyId, dto.leadId ?? null, dto.opportunityId ?? null, dto.customerId ?? null,
       assignedUserId, dto.activityType, dto.subject.trim(), dto.description ?? null, dto.dueAt ?? null, user.userId],
    );
    const activity = result.rows[0];
    await this.auditChange(user, 'crm.activity.create', 'crm_activity', String(activity.id), { subject: dto.subject, activityType: dto.activityType });
    return activity;
  }

  async completeActivity(user: AuthenticatedUser, id: string, dto: UpdateActivityDto) {
    const companyId = await this.companyId(user);
    const result = await this.db.query(
      `UPDATE crm_activities SET completed_at=CASE WHEN $3::boolean THEN COALESCE(completed_at,NOW()) ELSE NULL END
       WHERE id=$1 AND company_id=$2 RETURNING *`,
      [id, companyId, dto.completed !== false],
    );
    if (!result.rows.length) throw new NotFoundException('CRM activity not found.');
    await this.auditChange(user, 'crm.activity.complete', 'crm_activity', id, { completed: dto.completed !== false });
    return result.rows[0];
  }

  async convertLeadToCustomer(user: AuthenticatedUser, leadId: string) {
    const membership = await this.membershipFor(user);
    const converted = await this.db.transaction(async (client) => {
      const leadResult = await client.query(
        `SELECT id, company_id, contact_name, organization_name, email, phone, status, converted_customer_id
         FROM crm_leads WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [leadId, membership.companyId],
      );
      const lead = leadResult.rows[0];
      if (!lead) throw new NotFoundException('CRM lead not found.');
      if (lead.converted_customer_id || lead.status === 'converted') throw new BadRequestException('This lead has already been converted.');
      if (lead.email) {
        const duplicate = await client.query(
          'SELECT id FROM customers WHERE company_id=$1 AND email=$2 LIMIT 1',
          [membership.companyId, lead.email],
        );
        if (duplicate.rows.length) throw new BadRequestException('A customer with this email already exists in this company.');
      }
      const customerResult = await client.query(
        `INSERT INTO customers (company_id,name,email,phone)
         VALUES ($1,$2,$3,$4)
         RETURNING id,name,email,phone,created_at`,
        [membership.companyId, lead.organization_name || lead.contact_name, lead.email, lead.phone],
      );
      const customer = customerResult.rows[0];
      const updated = await client.query(
        `UPDATE crm_leads SET status='converted', converted_customer_id=$1, updated_at=NOW()
         WHERE id=$2 AND company_id=$3
         RETURNING id,contact_name,organization_name,status,converted_customer_id,updated_at`,
        [customer.id, leadId, membership.companyId],
      );
      return { customer, lead: updated.rows[0] };
    });
    await this.auditChange(user, 'crm.lead.convert', 'crm_lead', leadId, { customerId: String(converted.customer.id) });
    return converted;
  }

  async listCampaigns(user: AuthenticatedUser, status?: string) {
    const allowedStatuses = ['planned', 'active', 'paused', 'completed', 'cancelled'];
    if (status && status !== 'all' && !allowedStatuses.includes(status)) {
      throw new BadRequestException('Invalid campaign status.');
    }
    const companyId = await this.companyId(user);
    const result = await this.db.query("SELECT c.*, COUNT(DISTINCT cl.lead_id)::int AS leads_count, COUNT(DISTINCT cl.lead_id) FILTER (WHERE cl.response_status IN ('responded','converted'))::int AS responses_count, COUNT(DISTINCT cs.segment_id)::int AS segments_count FROM crm_campaigns c LEFT JOIN crm_campaign_leads cl ON cl.campaign_id=c.id AND cl.company_id=c.company_id LEFT JOIN crm_campaign_segments cs ON cs.campaign_id=c.id AND cs.company_id=c.company_id WHERE c.company_id=$1 AND ($2::text IS NULL OR c.status=$2) GROUP BY c.id ORDER BY c.created_at DESC LIMIT 200", [companyId, status ?? null]);
    return result.rows;
  }

  async createCampaign(user: AuthenticatedUser, dto: CreateCampaignDto) {
    if (dto.startDate && dto.endDate && dto.endDate < dto.startDate) {
      throw new BadRequestException('Campaign end date cannot be before its start date.');
    }
    const membership = await this.membershipFor(user);
    const result = await this.db.query("INSERT INTO crm_campaigns (company_id,name,campaign_type,status,start_date,end_date,budget,actual_cost,target_leads,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *", [membership.companyId,dto.name.trim(),dto.campaignType ?? 'other',dto.status ?? 'planned',dto.startDate ?? null,dto.endDate ?? null,dto.budget ?? 0,dto.actualCost ?? 0,dto.targetLeads ?? 0,dto.notes ?? null,user.userId]);
    const campaign = result.rows[0];
    await this.auditChange(user,'crm.campaign.create','crm_campaign',String(campaign.id),{name:dto.name,status:campaign.status});
    return campaign;
  }

  async updateCampaign(user: AuthenticatedUser, id: string, dto: UpdateCampaignDto) {
    const companyId = await this.companyId(user);
    const current = await this.db.query<{ start_date: string | null; end_date: string | null }>(
      'SELECT start_date, end_date FROM crm_campaigns WHERE id=$1 AND company_id=$2',
      [id, companyId],
    );
    if (!current.rows.length) throw new NotFoundException('CRM campaign not found.');
    const startDate = dto.startDate ?? current.rows[0].start_date;
    const endDate = dto.endDate ?? current.rows[0].end_date;
    if (startDate && endDate && String(endDate).slice(0, 10) < String(startDate).slice(0, 10)) {
      throw new BadRequestException('Campaign end date cannot be before its start date.');
    }
    const result = await this.db.query("UPDATE crm_campaigns SET name=COALESCE($3,name), campaign_type=COALESCE($4,campaign_type), status=COALESCE($5,status), start_date=COALESCE($6,start_date), end_date=COALESCE($7,end_date), budget=COALESCE($8,budget), actual_cost=COALESCE($9,actual_cost), target_leads=COALESCE($10,target_leads), notes=COALESCE($11,notes), updated_at=NOW() WHERE id=$1 AND company_id=$2 RETURNING *", [id,companyId,dto.name ?? null,dto.campaignType ?? null,dto.status ?? null,dto.startDate ?? null,dto.endDate ?? null,dto.budget ?? null,dto.actualCost ?? null,dto.targetLeads ?? null,dto.notes ?? null]);
    if (!result.rows.length) throw new NotFoundException('CRM campaign not found.');
    await this.auditChange(user,'crm.campaign.update','crm_campaign',id,{...dto});
    return result.rows[0];
  }

  async addCampaignLead(user: AuthenticatedUser, campaignId: string, dto: AddCampaignLeadDto) {
    const companyId = await this.companyId(user);
    const campaign = await this.db.query('SELECT id FROM crm_campaigns WHERE id=$1 AND company_id=$2',[campaignId,companyId]);
    if (!campaign.rows.length) throw new NotFoundException('CRM campaign not found.');
    await this.getLead(user,dto.leadId);
    const result = await this.db.query("INSERT INTO crm_campaign_leads(company_id,campaign_id,lead_id,response_status) VALUES($1,$2,$3,$4) ON CONFLICT(campaign_id,lead_id) DO UPDATE SET response_status=EXCLUDED.response_status RETURNING *", [companyId,campaignId,dto.leadId,dto.responseStatus ?? 'targeted']);
    await this.auditChange(user,'crm.campaign.add_lead','crm_campaign',campaignId,{leadId:dto.leadId,responseStatus:dto.responseStatus ?? 'targeted'});
    return result.rows[0];
  }

  async listCampaignLeads(user: AuthenticatedUser, campaignId: string) {
    const companyId = await this.companyId(user);
    const campaign = await this.db.query('SELECT id FROM crm_campaigns WHERE id=$1 AND company_id=$2',[campaignId,companyId]);
    if (!campaign.rows.length) throw new NotFoundException('CRM campaign not found.');
    const result = await this.db.query('SELECT cl.lead_id,cl.response_status,cl.added_at,l.contact_name,l.organization_name,l.email,l.phone FROM crm_campaign_leads cl JOIN crm_leads l ON l.id=cl.lead_id AND l.company_id=cl.company_id WHERE cl.company_id=$1 AND cl.campaign_id=$2 ORDER BY l.contact_name',[companyId,campaignId]);
    return result.rows;
  }

  async updateCampaignLead(user: AuthenticatedUser, campaignId: string, leadId: string, dto: UpdateCampaignLeadDto) {
    const companyId = await this.companyId(user);
    const result = await this.db.query('UPDATE crm_campaign_leads SET response_status=COALESCE($4,response_status) WHERE company_id=$1 AND campaign_id=$2 AND lead_id=$3 RETURNING *',[companyId,campaignId,leadId,dto.responseStatus ?? null]);
    if (!result.rows.length) throw new NotFoundException('Lead is not part of this campaign.');
    await this.auditChange(user,'crm.campaign.update_response','crm_campaign',campaignId,{leadId,responseStatus:result.rows[0].response_status});
    return result.rows[0];
  }

  async addCampaignSegment(user: AuthenticatedUser, campaignId: string, dto: AddCampaignSegmentDto) {
    const companyId = await this.companyId(user);
    const campaign = await this.db.query('SELECT id FROM crm_campaigns WHERE id=$1 AND company_id=$2',[campaignId,companyId]);
    if (!campaign.rows.length) throw new NotFoundException('CRM campaign not found.');
    const segment = await this.db.query('SELECT id FROM crm_segments WHERE id=$1 AND company_id=$2',[dto.segmentId,companyId]);
    if (!segment.rows.length) throw new NotFoundException('CRM segment not found.');
    const result = await this.db.query('INSERT INTO crm_campaign_segments(company_id,campaign_id,segment_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *',[companyId,campaignId,dto.segmentId]);
    await this.auditChange(user,'crm.campaign.add_segment','crm_campaign',campaignId,{segmentId:dto.segmentId});
    return result.rows[0] ?? {success:true,alreadyLinked:true};
  }

  async listSegments(user: AuthenticatedUser) {
    const companyId = await this.companyId(user);
    const result = await this.db.query("SELECT s.*, CASE WHEN s.is_dynamic THEN (SELECT COUNT(*)::int FROM crm_leads l WHERE l.company_id=s.company_id AND (s.criteria->>'leadStatus' IS NULL OR l.status=s.criteria->>'leadStatus') AND (s.criteria->>'source' IS NULL OR l.source=s.criteria->>'source')) ELSE COUNT(sm.id)::int END AS members_count FROM crm_segments s LEFT JOIN crm_segment_members sm ON sm.segment_id=s.id AND sm.company_id=s.company_id WHERE s.company_id=$1 GROUP BY s.id ORDER BY s.name LIMIT 200", [companyId]);
    return result.rows;
  }

  async createSegment(user: AuthenticatedUser, dto: CreateSegmentDto) {
    const membership = await this.membershipFor(user);
    const criteria = dto.criteria ?? {};
    if (dto.isDynamic && Object.keys(criteria).some(key => !['leadStatus','source'].includes(key))) throw new BadRequestException('Dynamic segments support only leadStatus and source criteria.');
    if (dto.isDynamic && criteria.leadStatus && !['new','qualified','unqualified','converted'].includes(String(criteria.leadStatus))) throw new BadRequestException('Invalid dynamic segment leadStatus.');
    const result = await this.db.query("INSERT INTO crm_segments(company_id,name,description,criteria,is_dynamic,created_by) VALUES($1,$2,$3,$4::jsonb,$5,$6) RETURNING *", [membership.companyId,dto.name.trim(),dto.description ?? null,JSON.stringify(criteria),dto.isDynamic ?? false,user.userId]);
    const segment = result.rows[0];
    await this.auditChange(user,'crm.segment.create','crm_segment',String(segment.id),{name:dto.name,isDynamic:segment.is_dynamic});
    return segment;
  }

  async addSegmentMember(user: AuthenticatedUser, segmentId: string, dto: AddSegmentMemberDto) {
    const companyId = await this.companyId(user);
    if (Boolean(dto.leadId) === Boolean(dto.customerId)) throw new BadRequestException('Provide exactly one lead or customer.');
    const segment = await this.db.query('SELECT id,is_dynamic FROM crm_segments WHERE id=$1 AND company_id=$2',[segmentId,companyId]);
    if (!segment.rows.length) throw new NotFoundException('CRM segment not found.');
    if (segment.rows[0].is_dynamic) throw new BadRequestException('Dynamic segments calculate membership from criteria; manual membership is not allowed.');
    if (dto.leadId) await this.getLead(user,dto.leadId);
    if (dto.customerId) {
      const customer = await this.db.query('SELECT id FROM customers WHERE id=$1 AND company_id=$2',[dto.customerId,companyId]);
      if (!customer.rows.length) throw new NotFoundException('CRM customer not found.');
    }
    const result = await this.db.query('INSERT INTO crm_segment_members(company_id,segment_id,lead_id,customer_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *', [companyId,segmentId,dto.leadId ?? null,dto.customerId ?? null]);
    await this.auditChange(user,'crm.segment.add_member','crm_segment',segmentId,{leadId:dto.leadId ?? null,customerId:dto.customerId ?? null});
    return result.rows[0] ?? {success:true,alreadyMember:true};
  }

  async listTickets(user: AuthenticatedUser, status?: string, priority?: string, search?: string) {
    const allowedStatuses = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'];
    const allowedPriorities = ['low', 'normal', 'high', 'urgent'];
    if (status && status !== 'all' && !allowedStatuses.includes(status)) {
      throw new BadRequestException('Invalid support ticket status.');
    }
    if (priority && priority !== 'all' && !allowedPriorities.includes(priority)) {
      throw new BadRequestException('Invalid support ticket priority.');
    }
    const companyId = await this.companyId(user);
    const result = await this.db.query("SELECT t.*,c.name AS customer_name,l.contact_name AS lead_contact_name,u.full_name AS assignee_name FROM crm_support_tickets t LEFT JOIN customers c ON c.id=t.customer_id AND c.company_id=t.company_id LEFT JOIN crm_leads l ON l.id=t.lead_id AND l.company_id=t.company_id LEFT JOIN company_memberships assigned_membership ON assigned_membership.user_id=t.assigned_user_id AND assigned_membership.company_id=t.company_id AND assigned_membership.is_active=TRUE LEFT JOIN users u ON u.id=assigned_membership.user_id WHERE t.company_id=$1 AND ($2::text IS NULL OR t.status=$2) AND ($3::text IS NULL OR t.priority=$3) AND ($4::text IS NULL OR t.subject ILIKE $4 OR t.description ILIKE $4 OR c.name ILIKE $4 OR l.contact_name ILIKE $4) ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,t.created_at DESC LIMIT 250", [companyId,status ?? null,priority ?? null,search ? '%' + search + '%' : null]);
    return result.rows;
  }

  async createTicket(user: AuthenticatedUser, dto: CreateTicketDto) {
    const membership = await this.membershipFor(user);
    if (Boolean(dto.customerId) === Boolean(dto.leadId)) {
      throw new BadRequestException('Link the ticket to exactly one customer or lead.');
    }
    if (dto.customerId) {
      const customer = await this.db.query('SELECT id FROM customers WHERE id=$1 AND company_id=$2',[dto.customerId,membership.companyId]);
      if (!customer.rows.length) throw new NotFoundException('CRM customer not found.');
    }
    if (dto.leadId) await this.getLead(user,dto.leadId);
    const assignedUserId = dto.assignedUserId ?? user.userId;
    const assigned = await this.db.query('SELECT user_id FROM company_memberships WHERE user_id=$1 AND company_id=$2 AND is_active=TRUE',[assignedUserId,membership.companyId]);
    if (!assigned.rows.length) throw new BadRequestException('The assigned user must be an active member of this company.');
    const result = await this.db.query("INSERT INTO crm_support_tickets(company_id,customer_id,lead_id,subject,description,status,priority,assigned_user_id,created_by,due_at,resolved_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $6::varchar IN ('resolved','closed') THEN NOW() ELSE NULL END) RETURNING *", [membership.companyId,dto.customerId ?? null,dto.leadId ?? null,dto.subject.trim(),dto.description ?? null,dto.status ?? 'open',dto.priority ?? 'normal',assignedUserId,user.userId,dto.dueAt ?? null]);
    const ticket = result.rows[0];
    await this.auditChange(user,'crm.ticket.create','crm_support_ticket',String(ticket.id),{subject:dto.subject,priority:ticket.priority});
    return ticket;
  }

  async updateTicket(user: AuthenticatedUser, id: string, dto: UpdateTicketDto) {
    const companyId = await this.companyId(user);
    if (dto.assignedUserId) {
      const assigned = await this.db.query('SELECT user_id FROM company_memberships WHERE user_id=$1 AND company_id=$2 AND is_active=TRUE',[dto.assignedUserId,companyId]);
      if (!assigned.rows.length) throw new BadRequestException('The assigned user must be an active member of this company.');
    }
    const result = await this.db.query("UPDATE crm_support_tickets SET status=COALESCE($3,status), priority=COALESCE($4,priority), assigned_user_id=COALESCE($5,assigned_user_id), due_at=COALESCE($6,due_at), description=COALESCE($7,description), resolved_at=CASE WHEN COALESCE($3,status) IN ('resolved','closed') THEN COALESCE(resolved_at,NOW()) ELSE NULL END, updated_at=NOW() WHERE id=$1 AND company_id=$2 RETURNING *", [id,companyId,dto.status ?? null,dto.priority ?? null,dto.assignedUserId ?? null,dto.dueAt ?? null,dto.description ?? null]);
    if (!result.rows.length) throw new NotFoundException('CRM support ticket not found.');
    await this.auditChange(user,'crm.ticket.update','crm_support_ticket',id,{...dto});
    return result.rows[0];
  }

  async pipelineSummary(user: AuthenticatedUser) {
    const companyId = await this.companyId(user);
    const [leads, opportunities, activities] = await Promise.all([
      this.db.query(`SELECT status,count(*)::int AS count,COALESCE(sum(estimated_value),0)::numeric AS value FROM crm_leads WHERE company_id=$1 GROUP BY status ORDER BY status`, [companyId]),
      this.db.query(`SELECT stage,count(*)::int AS count,COALESCE(sum(expected_value),0)::numeric AS value,COALESCE(sum(expected_value*probability/100.0),0)::numeric AS weighted_value FROM crm_opportunities WHERE company_id=$1 GROUP BY stage ORDER BY stage`, [companyId]),
      this.db.query(`SELECT count(*) FILTER (WHERE completed_at IS NULL)::int AS pending, count(*) FILTER (WHERE completed_at IS NULL AND due_at < NOW())::int AS overdue FROM crm_activities WHERE company_id=$1`, [companyId]),
    ]);
    return { leads: leads.rows, opportunities: opportunities.rows, activities: activities.rows[0], currency: 'KES' };
  }
}
