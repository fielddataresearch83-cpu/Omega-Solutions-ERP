import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

type SearchRow = Record<string, unknown> & {
  title?: unknown;
  subtitle?: unknown;
};

function relevance(row: SearchRow, term: string): number {
  const normalized = term.toLocaleLowerCase();
  const title = String(row.title ?? '').toLocaleLowerCase();
  const subtitle = String(row.subtitle ?? '').toLocaleLowerCase();
  if (title === normalized) return 0;
  if (title.startsWith(normalized)) return 1;
  if (title.includes(normalized)) return 2;
  if (subtitle.includes(normalized)) return 3;
  return 4;
}

@Injectable()
export class SearchService {
  constructor(private readonly db: DatabaseService) {}

  async search(user: AuthenticatedUser, rawQuery: string) {
    const term = rawQuery.trim().slice(0, 100);
    if (!term || !user.companyId) return [];
    const pattern = `%${term.replace(/[\\\\%_]/g, '\\\\$&')}%`;
    const permissions = new Set(user.permissions ?? []);
    if (!['customers:read', 'products:read', 'inventory:read', 'suppliers:read', 'sales:read', 'employees:read']
      .some((permission) => permissions.has(permission))) return [];
    const subscription = await this.db.query<{ status: string; modules: string[] }>(
      `SELECT s.status, p.modules
       FROM company_subscriptions s
       JOIN subscription_plans p ON p.code = s.plan_code
       WHERE s.company_id = $1`,
      [user.companyId],
    );

    // Fail closed when no subscription entitlement can be resolved. Search is
    // a data-access path and must not grant modules implicitly to legacy tenants.
    let moduleEnabled: (code: string) => boolean = () => false;
    if (subscription.rows.length) {
      const current = subscription.rows[0];
      if (!['active', 'trialing'].includes(current.status)) return [];
      const enabledModules = new Set(current.modules);
      const overrides = await this.db.query<{ module_code: string; enabled: boolean }>(
        `SELECT module_code, enabled FROM company_module_overrides
         WHERE company_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
        [user.companyId],
      );
      for (const override of overrides.rows) {
        if (override.enabled) enabledModules.add(override.module_code);
        else enabledModules.delete(override.module_code);
      }
      const dependencies: Record<string, string[]> = {
        core: [], inventory: ['core'], sales: ['core'], pos: ['sales', 'inventory'],
        accounting: ['core'], procurement: ['inventory'], manufacturing: ['inventory', 'accounting'],
        crm: ['sales'], hr_workforce: ['core'], reports: ['core'],
      };
      const resolve = (code: string, visited = new Set<string>()): boolean => {
        if (visited.has(code)) return true;
        visited.add(code);
        if (!enabledModules.has(code)) return false;
        return (dependencies[code] ?? []).every((dependency) => resolve(dependency, new Set(visited)));
      };
      moduleEnabled = resolve;
    }

    const jobs: Promise<{ rows: SearchRow[] }>[] = [];
    const add = (allowed: boolean, sql: string, params: unknown[]) => {
      if (allowed) jobs.push(this.db.query(sql, params as (string | number | boolean | Date | null)[]));
    };
    add(permissions.has('customers:read') && moduleEnabled('sales'),
      `SELECT id, name AS title, 'Customer' AS type, '/customers' AS url, COALESCE(email, phone, '') AS subtitle
       FROM customers WHERE company_id=$1 AND (name ILIKE $2 OR email ILIKE $2 OR phone ILIKE $2)
       ORDER BY name LIMIT 5`, [user.companyId, pattern]);
    add((permissions.has('products:read') || permissions.has('inventory:read')) && moduleEnabled('inventory'),
      `SELECT id, name AS title, 'Product' AS type, '/products' AS url, COALESCE(sku, '') AS subtitle
       FROM products WHERE company_id=$1 AND (name ILIKE $2 OR sku ILIKE $2 OR description ILIKE $2)
       ORDER BY name LIMIT 5`, [user.companyId, pattern]);
    add(permissions.has('suppliers:read') && moduleEnabled('procurement'),
      `SELECT id, name AS title, 'Supplier' AS type, '/suppliers' AS url, COALESCE(email, phone, '') AS subtitle
       FROM suppliers WHERE company_id=$1 AND (name ILIKE $2 OR email ILIKE $2 OR phone ILIKE $2)
       ORDER BY name LIMIT 5`, [user.companyId, pattern]);
    add(permissions.has('sales:read') && moduleEnabled('sales'),
      `SELECT i.id, i.invoice_number AS title, 'Invoice' AS type, '/invoices' AS url,
              COALESCE(c.name, '') || ' · ' || i.status AS subtitle
       FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id AND c.company_id=i.company_id
       WHERE i.company_id=$1
         AND ($3::uuid IS NULL OR EXISTS (
           SELECT 1 FROM pos_sales ps
           JOIN pos_registers pr ON pr.id=ps.register_id AND pr.company_id=ps.company_id
           WHERE ps.company_id=i.company_id AND ps.invoice_id=i.id AND pr.branch_id=$3::uuid
         ))
         AND (i.invoice_number ILIKE $2 OR c.name ILIKE $2)
       ORDER BY i.created_at DESC LIMIT 5`, [user.companyId, pattern, user.branchId ?? null]);
    add(permissions.has('employees:read') && moduleEnabled('hr_workforce'),
      `SELECT id, concat(first_name, ' ', last_name) AS title, 'Employee' AS type, '/employees' AS url,
              COALESCE(employee_number, work_email, '') AS subtitle
       FROM employees WHERE company_id=$1 AND ($3::uuid IS NULL OR branch_id=$3) AND
         (first_name ILIKE $2 OR last_name ILIKE $2 OR employee_number ILIKE $2 OR work_email ILIKE $2)
       ORDER BY first_name, last_name LIMIT 5`, [user.companyId, pattern, user.branchId ?? null]);
    const results = await Promise.all(jobs);
    return results.flatMap((result) => result.rows)
      .map((row, index) => ({ row, index, score: relevance(row, term) }))
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .map(({ row }) => row);
  }
}
