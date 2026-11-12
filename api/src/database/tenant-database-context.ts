import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantDatabaseContext {
  userId: string;
  companyId: string;
  branchId: string | null;
}

export const tenantDatabaseContext = new AsyncLocalStorage<TenantDatabaseContext>();
