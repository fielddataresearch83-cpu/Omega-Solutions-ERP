import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { tenantDatabaseContext } from './database/tenant-database-context.js';

export type QueryParams = (string | number | boolean | Date | null)[];

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number | null;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL is missing from the environment.');
    }

    this.pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 10000,
      max: 10,
      ssl: connectionString.includes('neon.tech')
        ? { rejectUnauthorized: true }
        : undefined,
    });
  }

  async onModuleInit() {
    try {
      await this.pool.query('SELECT 1');
      const connectionUrl = new URL(process.env.DATABASE_URL!);
      console.log('Database connection target:', {
        host: connectionUrl.hostname,
        database: decodeURIComponent(connectionUrl.pathname.slice(1)),
      });
      console.log('Neon PostgreSQL connection successful.');
    } catch (err) {
      console.error('Database connection failed:', err);
      throw err;
    }
  }

  async checkConnection(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: QueryParams,
  ): Promise<QueryResult<T>> {
    const tenant = tenantDatabaseContext.getStore();
    if (!tenant) {
      const result = await this.pool.query(text, params);
      return { rows: result.rows as T[], rowCount: result.rowCount };
    }

    // SET LOCAL is transaction-bound and cannot leak through the pool.
    const client = await this.pool.connect();
    let releaseError: Error | undefined;
    try {
      await client.query('BEGIN');
      await this.applyTenantContext(client, tenant);
      const result = await client.query(text, params);
      await client.query('COMMIT');
      return { rows: result.rows as T[], rowCount: result.rowCount };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        releaseError = rollbackError instanceof Error ? rollbackError : new Error('Tenant query rollback failed.');
      }
      throw error;
    } finally {
      client.release(releaseError);
    }
  }

  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  /**
   * Execute a callback within a transaction. Commits on success,
   * rolls back on error, and always releases the client.
   */
  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let releaseError: Error | undefined;
    try {
      await client.query('BEGIN');
      const tenant = tenantDatabaseContext.getStore();
      if (tenant) await this.applyTenantContext(client, tenant);
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        // Preserve the operation's original error and discard a connection whose
        // transaction state may be uncertain instead of returning it to the pool.
        releaseError =
          rollbackErr instanceof Error
            ? rollbackErr
            : new Error('Transaction rollback failed.');
      }
      throw err;
    } finally {
      client.release(releaseError);
    }
  }

  private async applyTenantContext(
    client: PoolClient,
    tenant: { userId: string; companyId: string; branchId: string | null },
  ): Promise<void> {
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.company_id', $2, true), set_config('app.branch_id', $3, true)",
      [tenant.userId, tenant.companyId, tenant.branchId ?? ''],
    );
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
