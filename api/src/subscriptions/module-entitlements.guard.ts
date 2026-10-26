import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../database.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import { REQUIRED_MODULE_KEY } from './require-module.decorator.js';

type SubscriptionRow = { status: string; modules: string[] };
type ModuleOverride = { module_code: string; enabled: boolean };

const MODULE_LABELS: Record<string, string> = {
  core: 'Omega Core', inventory: 'Inventory & Warehousing', sales: 'Sales',
  pos: 'Point of Sale', accounting: 'Finance & Accounting', procurement: 'Procurement',
  manufacturing: 'Manufacturing', crm: 'CRM', hr_workforce: 'HR & Workforce',
  reports: 'Reports & Business Intelligence',
};
const MODULE_DEPENDENCIES: Record<string, string[]> = {
  core: [], inventory: ['core'], sales: ['core'], pos: ['sales', 'inventory'],
  accounting: ['core'], procurement: ['inventory', 'accounting'], manufacturing: ['inventory', 'accounting'],
  crm: ['sales'], hr_workforce: ['core'], reports: ['core'],
};

@Injectable()
export class ModuleEntitlementsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly database: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredModule = this.reflector.getAllAndOverride<string>(
      REQUIRED_MODULE_KEY, [context.getHandler(), context.getClass()],
    );
    if (!requiredModule) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user?.companyId) throw new ForbiddenException('Select a company before accessing this module.');

    const result = await this.database.query<SubscriptionRow>(
      `SELECT s.status, p.modules FROM company_subscriptions s
       JOIN subscription_plans p ON p.code = s.plan_code WHERE s.company_id = $1`,
      [user.companyId],
    );
    // Existing tenants are not locked out until a subscription is explicitly assigned.
    if (!result.rows.length) return true;

    const subscription = result.rows[0];
    if (!['active', 'trialing'].includes(subscription.status)) {
      throw new ForbiddenException('This company subscription is not active. Contact your company administrator.');
    }

    const enabledModules = new Set(subscription.modules);
    const overrides = await this.database.query<ModuleOverride>(
      `SELECT module_code, enabled FROM company_module_overrides
       WHERE company_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [user.companyId],
    );
    for (const override of overrides.rows) {
      if (override.enabled) enabledModules.add(override.module_code);
      else enabledModules.delete(override.module_code);
    }

    const missing = this.findMissingDependency(requiredModule, enabledModules);
    if (missing) {
      const label = MODULE_LABELS[missing] ?? missing;
      throw new ForbiddenException(
        `The ${label} module is not enabled for this company. Ask an owner or administrator to change the subscription.`,
      );
    }
    return true;
  }

  private findMissingDependency(moduleCode: string, enabled: Set<string>, visited = new Set<string>()): string | null {
    if (visited.has(moduleCode)) return null;
    visited.add(moduleCode);
    if (!enabled.has(moduleCode)) return moduleCode;
    for (const dependency of MODULE_DEPENDENCIES[moduleCode] ?? []) {
      const missing = this.findMissingDependency(dependency, enabled, visited);
      if (missing) return missing;
    }
    return null;
  }
}
