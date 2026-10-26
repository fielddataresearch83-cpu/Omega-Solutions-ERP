import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database.service.js';

const MODULE_LABELS: Record<string, string> = {
  core: 'Omega Core',
  inventory: 'Inventory & Warehousing',
  sales: 'Sales',
  pos: 'Point of Sale',
  reports: 'Reports',
  accounting: 'Finance & Accounting',
  procurement: 'Procurement',
  crm: 'CRM',
  manufacturing: 'Manufacturing',
  hr_workforce: 'HR & Workforce',
};


const MODULE_CATALOGUE = [
  { code: 'core', category: 'Platform', description: 'Company identity, branches, users, roles, permissions and audit controls.', dependencies: [] },
  { code: 'inventory', category: 'Operations', description: 'Products, stock levels, warehouses, transfers and stock movements.', dependencies: ['core'] },
  { code: 'sales', category: 'Commercial', description: 'Customers, quotations, sales orders, invoices and credit notes.', dependencies: ['core'] },
  { code: 'pos', category: 'Commercial', description: 'Point-of-sale registers, shifts, checkout and salesperson stock workflows.', dependencies: ['sales', 'inventory'] },
  { code: 'accounting', category: 'Finance', description: 'Chart of accounts, journals, financial reports and reconciliation.', dependencies: ['core'] },
  { code: 'procurement', category: 'Operations', description: 'Requisitions, purchase orders, supplier bills and purchasing contracts.', dependencies: ['inventory', 'accounting'] },
  { code: 'manufacturing', category: 'Operations', description: 'Bills of materials, production orders and production costing.', dependencies: ['inventory', 'accounting'] },
  { code: 'crm', category: 'Commercial', description: 'Leads, opportunities, campaigns, customer segments and support tickets.', dependencies: ['sales'] },
  { code: 'hr_workforce', category: 'People', description: 'Employees, workforce operations, attendance and payroll.', dependencies: ['core'] },
  { code: 'reports', category: 'Insights', description: 'Business reporting and cross-module performance visibility.', dependencies: ['core'] },
] as const;

@Injectable()
export class SubscriptionsService {
  constructor(private readonly db: DatabaseService) {}

  async getPlans() {
    const result = await this.db.query<{
      code: string;
      name: string;
      description: string;
      monthly_price_kes: number;
      is_custom_pricing: boolean;
      max_users: number;
      max_branches: number;
      modules: string[];
    }>(
      `SELECT code, name, description, monthly_price_kes, is_custom_pricing, max_users, max_branches, modules
       FROM subscription_plans WHERE is_active = TRUE
       ORDER BY is_custom_pricing ASC, monthly_price_kes ASC`,
    );

    return result.rows.map((plan) => ({
      code: plan.code,
      name: plan.name,
      description: plan.description,
      monthlyPriceKes: Number(plan.monthly_price_kes),
      isCustomPricing: plan.is_custom_pricing,
      currency: 'KES',
      billingPeriod: 'monthly',
      limits: { users: plan.max_users, branches: plan.max_branches },
      modules: plan.modules.map((code) => ({
        code,
        name: MODULE_LABELS[code] ?? code,
      })),
    }));
  }

  async getCurrent(companyId: string) {
    const result = await this.db.query<{
      plan_code: string;
      status: string;
      billing_period: string;
      current_period_start: Date | null;
      current_period_end: Date | null;
      plan_name: string;
      monthly_price_kes: number;
      max_users: number;
      max_branches: number;
      modules: string[];
    }>(
      `SELECT s.plan_code, s.status, s.billing_period, s.current_period_start,
              s.current_period_end, p.name AS plan_name, p.monthly_price_kes,
              p.max_users, p.max_branches, p.modules
       FROM company_subscriptions s
       JOIN subscription_plans p ON p.code = s.plan_code
       WHERE s.company_id = $1`,
      [companyId],
    );

    if (!result.rows.length) {
      // Preserve access for existing tenants until payment and entitlement enforcement
      // have been rolled out; this is not a paid subscription.
      return {
        subscription: null,
        accessMode: 'legacy_unmetered',
        message: 'No subscription is recorded for this company yet.',
      };
    }

    const row = result.rows[0];
    const overrides = await this.db.query<{ module_code: string; enabled: boolean }>(
      `SELECT module_code, enabled FROM company_module_overrides
       WHERE company_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [companyId],
    );
    const moduleAccess = new Map(row.modules.map((module) => [module, true]));
    for (const override of overrides.rows) moduleAccess.set(override.module_code, override.enabled);

    return {
      subscription: {
        planCode: row.plan_code,
        planName: row.plan_name,
        status: row.status,
        billingPeriod: row.billing_period,
        monthlyPriceKes: Number(row.monthly_price_kes),
        currentPeriodStart: row.current_period_start,
        currentPeriodEnd: row.current_period_end,
        limits: { users: row.max_users, branches: row.max_branches },
      },
      accessMode: 'subscription',
      modules: Object.fromEntries(moduleAccess),
    };
  }


  async getModuleCatalogue(companyId: string) {
    const subscriptionResult = await this.db.query<{
      status: string;
      plan_code: string;
      plan_name: string;
      modules: string[];
    }>(
      `SELECT s.status, s.plan_code, p.name AS plan_name, p.modules
       FROM company_subscriptions s
       JOIN subscription_plans p ON p.code = s.plan_code
       WHERE s.company_id = $1`,
      [companyId],
    );

    const subscription = subscriptionResult.rows[0];
    const overridesResult = await this.db.query<{ module_code: string; enabled: boolean }>(
      `SELECT module_code, enabled FROM company_module_overrides
       WHERE company_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [companyId],
    );
    const overrides = new Map(overridesResult.rows.map((row) => [row.module_code, row.enabled]));
    const legacy = !subscription;
    const subscriptionActive = !subscription || ['active', 'trialing'].includes(subscription.status);
    const planModules = new Set(subscription?.modules ?? MODULE_CATALOGUE.map((module) => module.code));

    const resolve = (code: string, visited = new Set<string>()): { enabled: boolean; missingDependencies: string[] } => {
      if (visited.has(code)) return { enabled: true, missingDependencies: [] };
      visited.add(code);
      const module = MODULE_CATALOGUE.find((entry) => entry.code === code);
      if (!module) return { enabled: false, missingDependencies: [code] };
      const entitled = legacy ? true : overrides.has(code) ? overrides.get(code)! : planModules.has(code);
      if (!subscriptionActive || !entitled) return { enabled: false, missingDependencies: [] };
      const missingDependencies: string[] = [];
      for (const dependency of module.dependencies) {
        const result = resolve(dependency, new Set(visited));
        if (!result.enabled) missingDependencies.push(dependency, ...result.missingDependencies);
      }
      const uniqueMissing = [...new Set(missingDependencies)];
      return { enabled: uniqueMissing.length === 0, missingDependencies: uniqueMissing };
    };

    return {
      accessMode: legacy ? 'legacy_unmetered' : 'subscription',
      subscription: subscription ? {
        planCode: subscription.plan_code,
        planName: subscription.plan_name,
        status: subscription.status,
      } : null,
      modules: MODULE_CATALOGUE.map((module) => {
        const overrideEnabled = overrides.get(module.code);
        const includedInPlan = legacy || planModules.has(module.code);
        const entitled = legacy ? true : overrideEnabled ?? includedInPlan;
        const access = resolve(module.code);
        return {
          ...module,
          dependencies: [...module.dependencies],
          includedInPlan,
          override: overrideEnabled === undefined ? null : overrideEnabled ? 'enabled' : 'disabled',
          entitled,
          enabled: access.enabled,
          missingDependencies: access.missingDependencies,
          status: !subscriptionActive ? 'subscription_inactive' :
            !entitled ? 'not_included' :
            access.missingDependencies.length ? 'missing_dependencies' : 'enabled',
        };
      }),
    };
  }

  async requestPlanChange(companyId: string, userId: string, planCode: string, note?: string) {
    const normalizedCode = planCode.trim().toLowerCase();
    if (!/^(starter|medium|professional|enterprise_custom)$/.test(normalizedCode)) {
      throw new BadRequestException('Choose Starter, Medium, Professional, or Enterprise.');
    }
    const plan = await this.db.query<{ code: string }>(
      'SELECT code FROM subscription_plans WHERE code = $1 AND is_active = TRUE',
      [normalizedCode],
    );
    if (!plan.rows.length) throw new NotFoundException('The selected plan is not available.');

    const result = await this.db.query<{
      id: string;
      requested_plan_code: string;
      status: string;
      created_at: Date;
    }>(
      `INSERT INTO subscription_change_requests
         (company_id, requested_by, requested_plan_code, note)
       VALUES ($1, $2, $3, $4)
       RETURNING id, requested_plan_code, status, created_at`,
      [companyId, userId, normalizedCode, note?.trim().slice(0, 1000) || null],
    );

    const isEnterpriseQuote = normalizedCode === 'enterprise_custom';
    return {
      request: result.rows[0],
      message: isEnterpriseQuote
        ? 'Enterprise quote request submitted. Our team must agree the price, user and branch limits, and onboarding scope before activation.'
        : 'Plan request submitted. Current access has not changed; activation requires billing confirmation.',
    };
  }
  async requestModuleChange(companyId: string, userId: string, moduleCode: string, note?: string) {
    const normalizedModule = moduleCode.trim().toLowerCase();
    if (!Object.keys(MODULE_LABELS).includes(normalizedModule) || normalizedModule === 'core') {
      throw new BadRequestException('Choose a valid optional Omega module.');
    }
    const subscriptionResult = await this.db.query<{ status: string; modules: string[] }>(
      `SELECT s.status, p.modules FROM company_subscriptions s
       JOIN subscription_plans p ON p.code = s.plan_code WHERE s.company_id = $1`,
      [companyId],
    );
    if (!subscriptionResult.rows.length) throw new BadRequestException('Choose a subscription plan before requesting an add-on module.');
    const subscription = subscriptionResult.rows[0];
    if (!['active', 'trialing'].includes(subscription.status)) {
      throw new BadRequestException('The subscription must be active before requesting add-on modules.');
    }
    const override = await this.db.query<{ enabled: boolean }>(
      `SELECT enabled FROM company_module_overrides
       WHERE company_id = $1 AND module_code = $2
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [companyId, normalizedModule],
    );
    if (subscription.modules.includes(normalizedModule) || override.rows[0]?.enabled) {
      throw new BadRequestException('This module is already included or enabled for your company.');
    }
    try {
      const result = await this.db.query<{
        id: string; module_code: string; status: string; created_at: Date;
      }>(
        `INSERT INTO subscription_module_requests (company_id, requested_by, module_code, note)
         VALUES ($1, $2, $3, $4) RETURNING id, module_code, status, created_at`,
        [companyId, userId, normalizedModule, note?.trim().slice(0, 1000) || null],
      );
      return {
        request: result.rows[0],
        message: 'Add-on request submitted. It will not be activated or charged until reviewed and confirmed.',
      };
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('There is already a pending request for this module.');
      }
      throw error;
    }
  }

  async assertBranchCapacity(companyId: string) {
    const plan = await this.db.query<{ status: string; max_branches: number; plan_name: string }>(
      `SELECT s.status, p.max_branches, p.name AS plan_name
       FROM company_subscriptions s JOIN subscription_plans p ON p.code = s.plan_code
       WHERE s.company_id = $1`,
      [companyId],
    );
    if (!plan.rows.length) return;
    const current = plan.rows[0];
    if (!['active', 'trialing'].includes(current.status)) {
      throw new ForbiddenException('An active subscription is required to add branches.');
    }
    const count = await this.db.query<{ used: number }>(
      'SELECT count(*)::int AS used FROM branches WHERE company_id = $1 AND is_active = true',
      [companyId],
    );
    if (count.rows[0].used >= current.max_branches) {
      throw new ForbiddenException(`Your ${current.plan_name} plan allows up to ${current.max_branches} active branches. Request a plan change to add more.`);
    }
  }

  async assertUserCapacity(companyId: string, client?: import('pg').PoolClient, acceptingReservedInvite = false) {
    const query = async <T extends Record<string, unknown>>(sql: string, params: (string | number | boolean | Date | null)[]) =>
      client ? client.query<T>(sql, params) : this.db.query<T>(sql, params);
    const plan = await query<{ status: string; max_users: number; plan_name: string }>(
      `SELECT s.status, p.max_users, p.name AS plan_name
       FROM company_subscriptions s JOIN subscription_plans p ON p.code = s.plan_code
       WHERE s.company_id = $1`,
      [companyId],
    );
    if (!plan.rows.length) return;
    const current = plan.rows[0];
    if (!['active', 'trialing'].includes(current.status)) {
      throw new ForbiddenException('An active subscription is required to invite or add users.');
    }
    const count = await query<{ used: number }>(
      `SELECT
         (SELECT count(*) FROM company_memberships WHERE company_id = $1 AND is_active = true)
         + (SELECT count(*) FROM company_invitations
            WHERE company_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()) AS used`,
      [companyId],
    );
    if (acceptingReservedInvite ? Number(count.rows[0].used) > current.max_users : Number(count.rows[0].used) >= current.max_users) {
      throw new ForbiddenException(`Your ${current.plan_name} plan allows up to ${current.max_users} users, including pending invitations. Remove an invitation or request a plan change.`);
    }
  }

}
