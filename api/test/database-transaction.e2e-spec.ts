import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database.service.js';
import { AuditService } from '../src/audit/audit.service.js';

describe('DatabaseService PostgreSQL transaction integration', () => {
  let db: DatabaseService;

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      'postgres://postgres:postgres@localhost:5432/omega_transaction_test';
    db = new DatabaseService();
    await db.query(
      'CREATE TABLE IF NOT EXISTS transaction_rollback_probe (id integer PRIMARY KEY, value text NOT NULL)',
    );
    await db.query('TRUNCATE TABLE transaction_rollback_probe');
  });

  afterAll(async () => {
    if (db) {
      try {
        await db.query('DROP TABLE IF EXISTS audit_logs CASCADE');
        await db.query('DROP TABLE IF EXISTS transaction_rollback_probe');
      } finally {
        await db.onModuleDestroy();
      }
    }
  });

  it('rolls back earlier writes when a later PostgreSQL write fails', async () => {
    await expect(
      db.transaction(async (client) => {
        await client.query(
          'INSERT INTO transaction_rollback_probe (id, value) VALUES ($1, $2)',
          [1, 'must roll back'],
        );
        // Trigger a real PostgreSQL unique-key violation after the first write succeeds.
        await client.query(
          'INSERT INTO transaction_rollback_probe (id, value) VALUES ($1, $2)',
          [1, 'duplicate key should fail'],
        );
      }),
    ).rejects.toMatchObject({ code: '23505' });

    const result = await db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM transaction_rollback_probe',
    );
    expect(result.rows[0]?.count).toBe('0');
  });


  it('rolls back a failed real payroll journal posting as one PostgreSQL transaction', async () => {
    // Minimal disposable schema for the real PayrollService.postRun path. This
    // database is the ephemeral PostgreSQL service created by the CI workflow.
    await db.query('DROP TABLE IF EXISTS journal_entry_lines, journal_entries, payroll_journal_sequences, chart_of_accounts, payroll_items, payroll_runs CASCADE');
    await db.query(`CREATE TABLE payroll_runs (
      id text PRIMARY KEY, company_id text NOT NULL, period_start date NOT NULL, period_end date NOT NULL,
      status text NOT NULL, employee_count integer NOT NULL, gross_total numeric(14,2) NOT NULL,
      employee_deductions_total numeric(14,2) NOT NULL, net_pay_total numeric(14,2) NOT NULL,
      employer_cost_total numeric(14,2) NOT NULL, journal_entry_id text, posted_by text, posted_at timestamptz,
      updated_at timestamptz DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE payroll_items (
      id text PRIMARY KEY, payroll_run_id text NOT NULL, company_id text NOT NULL, employee_number text NOT NULL,
      gross_cash_pay numeric(14,2) NOT NULL, taxable_benefits numeric(14,2) NOT NULL DEFAULT 0,
      nssf_employer numeric(14,2) NOT NULL DEFAULT 0, housing_levy_employer numeric(14,2) NOT NULL DEFAULT 0,
      employer_statutory_cost numeric(14,2) NOT NULL DEFAULT 0, employee_deductions numeric(14,2) NOT NULL,
      net_pay numeric(14,2) NOT NULL, paye numeric(14,2) NOT NULL DEFAULT 0,
      shif_employee numeric(14,2) NOT NULL DEFAULT 0, nssf_employee numeric(14,2) NOT NULL DEFAULT 0,
      housing_levy_employee numeric(14,2) NOT NULL DEFAULT 0, pension_employee numeric(14,2) NOT NULL DEFAULT 0,
      prmf_employee numeric(14,2) NOT NULL DEFAULT 0
    )`);
    await db.query(`CREATE TABLE chart_of_accounts (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text, company_id text NOT NULL, code text NOT NULL,
      name text NOT NULL, account_type text NOT NULL, normal_side text NOT NULL, system_code text NOT NULL,
      is_active boolean NOT NULL DEFAULT true, UNIQUE(company_id, code)
    )`);
    await db.query(`CREATE TABLE payroll_journal_sequences (
      company_id text NOT NULL, entry_year integer NOT NULL, next_number integer NOT NULL,
      PRIMARY KEY(company_id, entry_year)
    )`);
    await db.query(`CREATE TABLE journal_entries (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text, company_id text NOT NULL, entry_number text NOT NULL,
      entry_date date NOT NULL, description text NOT NULL, source_type text NOT NULL, source_id text NOT NULL,
      status text NOT NULL, posted_at timestamptz, posted_by text NOT NULL
    )`);
    await db.query(`CREATE TABLE journal_entry_lines (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text, company_id text NOT NULL, journal_entry_id text NOT NULL,
      account_id text NOT NULL, description text NOT NULL, debit numeric(14,2) NOT NULL, credit numeric(14,2) NOT NULL
    )`);
    await db.query(`INSERT INTO payroll_runs(id,company_id,period_start,period_end,status,employee_count,gross_total,employee_deductions_total,net_pay_total,employer_cost_total)
      VALUES('payroll-run-real','company-a','2026-10-01','2026-10-31','approved',1,100000,20250,79750,107500)`);
    await db.query(`INSERT INTO payroll_items(id,payroll_run_id,company_id,employee_number,gross_cash_pay,taxable_benefits,nssf_employer,housing_levy_employer,employer_statutory_cost,employee_deductions,net_pay,paye,shif_employee,nssf_employee,housing_levy_employee)
      VALUES('payroll-item-real','payroll-run-real','company-a','E-1',100000,0,6000,1500,7500,20250,79750,10000,2750,6000,1500)`);
    // The first journal line insert fails after the journal header succeeds.
    await db.query(`CREATE FUNCTION fail_payroll_journal_line() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''forced payroll journal-line failure''; END;'`);
    await db.query(`CREATE TRIGGER fail_payroll_journal_line_trigger BEFORE INSERT ON journal_entry_lines
      FOR EACH ROW EXECUTE FUNCTION fail_payroll_journal_line()`);

    const { PayrollService } = await import('../src/payroll/payroll.service.js');
    const memberships = {
      getMembership: async () => ({ companyId: 'company-a' }),
      getMembershipForCompany: async () => ({ companyId: 'company-a' }),
    };
    const service = new PayrollService(db, memberships as never);
    const user = {
      userId: 'user-a', email: 'user@example.test', fullName: 'Test Owner',
      companyId: 'company-a', branchId: null, role: 'owner', permissions: [],
    };
    await expect(service.postRun(user, 'payroll-run-real')).rejects.toThrow('forced payroll journal-line failure');

    const run = await db.query<{ status: string; journal_entry_id: string | null }>(
      'SELECT status,journal_entry_id FROM payroll_runs WHERE id=$1', ['payroll-run-real'],
    );
    const journals = await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM journal_entries');
    const lines = await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM journal_entry_lines');
    const sequence = await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM payroll_journal_sequences');
    expect(run.rows[0]).toEqual({ status: 'approved', journal_entry_id: null });
    expect(journals.rows[0]?.count).toBe('0');
    expect(lines.rows[0]?.count).toBe('0');
    expect(sequence.rows[0]?.count).toBe('0');

    await db.query('DROP TRIGGER fail_payroll_journal_line_trigger ON journal_entry_lines');
    await db.query('DROP FUNCTION fail_payroll_journal_line()');
    await db.query('DROP TABLE journal_entry_lines, journal_entries, payroll_journal_sequences, chart_of_accounts, payroll_items, payroll_runs CASCADE');
  });

  it('prevents concurrent remittance payments from exceeding an obligation balance', async () => {
    await db.query('DROP TABLE IF EXISTS payroll_remittance_payments, payroll_remittance_obligations CASCADE');
    await db.query(`CREATE TABLE payroll_remittance_obligations (
      id text PRIMARY KEY, company_id text NOT NULL, amount numeric(14,2) NOT NULL
    )`);
    await db.query(`CREATE TABLE payroll_remittance_payments (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text, company_id text NOT NULL, obligation_id text NOT NULL,
      amount numeric(14,2) NOT NULL, payment_reference text NOT NULL, paid_at timestamptz NOT NULL,
      receipt_storage_key text, notes text, recorded_by text, created_at timestamptz NOT NULL DEFAULT NOW(),
      UNIQUE(company_id, payment_reference)
    )`);
    await db.query(`INSERT INTO payroll_remittance_obligations(id,company_id,amount)
      VALUES('obligation-race','company-a',100.00)`);

    const { PayrollRemittancesService } = await import('../src/payroll/payroll-remittances.service.js');
    const memberships = {
      getMembership: async () => ({ companyId: 'company-a' }),
      getMembershipForCompany: async () => ({ companyId: 'company-a' }),
    };
    const service = new PayrollRemittancesService(db, memberships as never);
    const user = {
      userId: 'user-a', email: 'user@example.test', fullName: 'Test Owner',
      companyId: 'company-a', branchId: null, role: 'owner', permissions: [],
    };

    const outcomes = await Promise.allSettled([
      service.recordPayment(user, 'obligation-race', { amount: 70, paymentReference: 'RACE-REF-A' }),
      service.recordPayment(user, 'obligation-race', { amount: 70, paymentReference: 'RACE-REF-B' }),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const payments = await db.query<{ count: string; total: string }>(
      'SELECT COUNT(*)::text AS count, COALESCE(SUM(amount),0)::text AS total FROM payroll_remittance_payments WHERE company_id=$1 AND obligation_id=$2',
      ['company-a', 'obligation-race'],
    );
    expect(payments.rows[0]).toEqual({ count: '1', total: '70.00' });

    await db.query('DROP TABLE payroll_remittance_payments, payroll_remittance_obligations CASCADE');
  });


  it('rolls back a business write when the real audit_logs INSERT fails', async () => {
    const audit = new AuditService(db);
    await db.query('DROP TABLE IF EXISTS audit_logs CASCADE');
    await db.query(`CREATE TABLE audit_logs (
      id bigserial PRIMARY KEY,
      user_id text,
      company_id text,
      branch_id text,
      action varchar(100) NOT NULL,
      entity_type varchar(50) NOT NULL,
      entity_id varchar(100),
      old_values jsonb,
      new_values jsonb,
      ip_address varchar(45),
      created_at timestamptz NOT NULL DEFAULT NOW()
    )`);
    await db.query(`CREATE FUNCTION fail_audit_probe_insert() RETURNS trigger
      LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''forced audit insert failure''; END;'`);
    await db.query(`CREATE TRIGGER fail_audit_probe_insert_trigger
      BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_audit_probe_insert()`);

    await expect(db.transaction(async (client) => {
      await client.query(
        'INSERT INTO transaction_rollback_probe (id, value) VALUES ($1, $2)',
        [3, 'business mutation must roll back'],
      );
      await audit.logInTransaction(client, {
        userId: 'user-a',
        companyId: 'company-a',
        branchId: null,
        action: 'test.business.mutation',
        entityType: 'transaction_rollback_probe',
        entityId: '3',
        oldValues: null,
        newValues: { value: 'business mutation must roll back' },
        ipAddress: null,
      });
    })).rejects.toThrow('forced audit insert failure');

    const business = await db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM transaction_rollback_probe WHERE id=$1',
      [3],
    );
    const events = await db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM audit_logs',
    );
    expect(business.rows[0]?.count).toBe('0');
    expect(events.rows[0]?.count).toBe('0');

    await db.query('DROP TRIGGER fail_audit_probe_insert_trigger ON audit_logs');
    await db.query('DROP FUNCTION fail_audit_probe_insert()');
    await db.query('DROP TABLE audit_logs CASCADE');
  });

  it('commits successful writes', async () => {
    await db.transaction(async (client) => {
      await client.query(
        'INSERT INTO transaction_rollback_probe (id, value) VALUES ($1, $2)',
        [2, 'committed'],
      );
    });

    const result = await db.query<{ value: string }>(
      'SELECT value FROM transaction_rollback_probe WHERE id = $1',
      [2],
    );
    expect(result.rows).toEqual([{ value: 'committed' }]);
  });
});
