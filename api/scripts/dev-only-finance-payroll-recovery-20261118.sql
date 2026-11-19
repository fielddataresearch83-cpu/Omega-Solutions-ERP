-- DEVELOPMENT ONLY. Apply to omega-migration-smoke-test-live, never Production.
-- Run this base schema before importing the preserved-branch records.
CREATE TABLE public."audit_logs" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "user_id" uuid,
  "company_id" uuid,
  "branch_id" uuid,
  "action" character varying(100) NOT NULL,
  "entity_type" character varying(50) NOT NULL,
  "entity_id" character varying(100),
  "old_values" jsonb,
  "new_values" jsonb,
  "ip_address" character varying(45),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "audit_logs_branch_id_fkey" FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  CONSTRAINT "audit_logs_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY (id),
  CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_pkey ON public.audit_logs USING btree (id);

CREATE INDEX IF NOT EXISTS idx_audit_user_id ON public.audit_logs USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_audit_company_id ON public.audit_logs USING btree (company_id);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON public.audit_logs USING btree (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_created_at ON public.audit_logs USING btree (created_at);

CREATE TABLE public."chart_of_accounts" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "code" character varying(20) NOT NULL,
  "name" character varying(160) NOT NULL,
  "account_type" character varying(20) NOT NULL,
  "normal_side" character varying(6) NOT NULL,
  "system_code" character varying(40),
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chart_of_accounts_account_type_check" CHECK (((account_type)::text = ANY ((ARRAY['asset'::character varying, 'liability'::character varying, 'equity'::character varying, 'income'::character varying, 'expense'::character varying])::text[]))),
  CONSTRAINT "chart_of_accounts_company_code_unique" UNIQUE (company_id, code),
  CONSTRAINT "chart_of_accounts_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT "chart_of_accounts_company_system_unique" UNIQUE (company_id, system_code),
  CONSTRAINT "chart_of_accounts_id_company_unique" UNIQUE (id, company_id),
  CONSTRAINT "chart_of_accounts_normal_side_check" CHECK (((normal_side)::text = ANY ((ARRAY['debit'::character varying, 'credit'::character varying])::text[]))),
  CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS chart_of_accounts_pkey ON public.chart_of_accounts USING btree (id);

CREATE UNIQUE INDEX IF NOT EXISTS chart_of_accounts_company_code_unique ON public.chart_of_accounts USING btree (company_id, code);

CREATE UNIQUE INDEX IF NOT EXISTS chart_of_accounts_id_company_unique ON public.chart_of_accounts USING btree (id, company_id);

CREATE INDEX IF NOT EXISTS idx_chart_accounts_company_type ON public.chart_of_accounts USING btree (company_id, account_type, is_active);

CREATE UNIQUE INDEX IF NOT EXISTS chart_of_accounts_company_system_unique ON public.chart_of_accounts USING btree (company_id, system_code);

CREATE TABLE public."journal_entries" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "entry_number" character varying(40) NOT NULL,
  "entry_date" date DEFAULT CURRENT_DATE NOT NULL,
  "description" character varying(500) NOT NULL,
  "source_type" character varying(40),
  "source_id" uuid,
  "status" character varying(16) DEFAULT 'posted'::character varying NOT NULL,
  "posted_at" timestamp with time zone,
  "posted_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "journal_entries_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT "journal_entries_company_number_unique" UNIQUE (company_id, entry_number),
  CONSTRAINT "journal_entries_id_company_unique" UNIQUE (id, company_id),
  CONSTRAINT "journal_entries_pkey" PRIMARY KEY (id),
  CONSTRAINT "journal_entries_posted_by_fkey" FOREIGN KEY (posted_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT "journal_entries_source_unique" UNIQUE (company_id, source_type, source_id),
  CONSTRAINT "journal_entries_status_check" CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'posted'::character varying, 'reversed'::character varying])::text[])))
);

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_pkey ON public.journal_entries USING btree (id);

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_company_number_unique ON public.journal_entries USING btree (company_id, entry_number);

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_source_unique ON public.journal_entries USING btree (company_id, source_type, source_id);

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_id_company_unique ON public.journal_entries USING btree (id, company_id);

CREATE INDEX IF NOT EXISTS idx_journal_entries_company_date ON public.journal_entries USING btree (company_id, entry_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_journal_entries_company_source ON public.journal_entries USING btree (company_id, source_type, source_id);

CREATE TABLE public."journal_entry_lines" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "journal_entry_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "description" character varying(300),
  "debit" numeric(14,2) DEFAULT 0 NOT NULL,
  "credit" numeric(14,2) DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "journal_entry_lines_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT "journal_entry_lines_credit_check" CHECK ((credit >= (0)::numeric)),
  CONSTRAINT "journal_entry_lines_debit_check" CHECK ((debit >= (0)::numeric)),
  CONSTRAINT "journal_entry_lines_pkey" PRIMARY KEY (id),
  CONSTRAINT "journal_line_one_side" CHECK ((((debit > (0)::numeric) AND (credit = (0)::numeric)) OR ((credit > (0)::numeric) AND (debit = (0)::numeric)))),
  CONSTRAINT "journal_lines_account_company_fk" FOREIGN KEY (account_id, company_id) REFERENCES chart_of_accounts(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT "journal_lines_entry_company_fk" FOREIGN KEY (journal_entry_id, company_id) REFERENCES journal_entries(id, company_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS journal_entry_lines_pkey ON public.journal_entry_lines USING btree (id);

CREATE INDEX IF NOT EXISTS idx_journal_lines_company_account ON public.journal_entry_lines USING btree (company_id, account_id, journal_entry_id);

CREATE TABLE public."payroll_runs" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "status" character varying(16) DEFAULT 'draft'::character varying NOT NULL,
  "employee_count" integer DEFAULT 0 NOT NULL,
  "gross_total" numeric(16,2) DEFAULT 0 NOT NULL,
  "employee_deductions_total" numeric(16,2) DEFAULT 0 NOT NULL,
  "net_pay_total" numeric(16,2) DEFAULT 0 NOT NULL,
  "employer_cost_total" numeric(16,2) DEFAULT 0 NOT NULL,
  "journal_entry_id" uuid,
  "created_by" uuid,
  "approved_by" uuid,
  "approved_at" timestamp with time zone,
  "posted_by" uuid,
  "posted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payroll_run_period_company_unique" UNIQUE (company_id, period_start, period_end),
  CONSTRAINT "payroll_run_period_valid" CHECK ((period_end >= period_start)),
  CONSTRAINT "payroll_runs_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT "payroll_runs_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT "payroll_runs_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT "payroll_runs_employee_count_check" CHECK ((employee_count >= 0)),
  CONSTRAINT "payroll_runs_id_company_unique" UNIQUE (id, company_id),
  CONSTRAINT "payroll_runs_journal_company_fk" FOREIGN KEY (journal_entry_id, company_id) REFERENCES journal_entries(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT "payroll_runs_pkey" PRIMARY KEY (id),
  CONSTRAINT "payroll_runs_posted_by_fkey" FOREIGN KEY (posted_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT "payroll_runs_status_check" CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'approved'::character varying, 'posted'::character varying, 'cancelled'::character varying])::text[])))
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_pkey ON public.payroll_runs USING btree (id);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_run_period_company_unique ON public.payroll_runs USING btree (company_id, period_start, period_end);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_id_company_unique ON public.payroll_runs USING btree (id, company_id);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_company_period ON public.payroll_runs USING btree (company_id, period_start DESC);

CREATE TABLE public."payroll_items" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "payroll_run_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "employee_number" character varying(50) NOT NULL,
  "employee_name" character varying(201) NOT NULL,
  "gross_cash_pay" numeric(14,2) NOT NULL,
  "taxable_benefits" numeric(14,2) DEFAULT 0 NOT NULL,
  "nssf_employee" numeric(14,2) DEFAULT 0 NOT NULL,
  "nssf_employer" numeric(14,2) DEFAULT 0 NOT NULL,
  "shif_employee" numeric(14,2) DEFAULT 0 NOT NULL,
  "housing_levy_employee" numeric(14,2) DEFAULT 0 NOT NULL,
  "housing_levy_employer" numeric(14,2) DEFAULT 0 NOT NULL,
  "paye" numeric(14,2) DEFAULT 0 NOT NULL,
  "pension_employee" numeric(14,2) DEFAULT 0 NOT NULL,
  "prmf_employee" numeric(14,2) DEFAULT 0 NOT NULL,
  "employee_deductions" numeric(14,2) DEFAULT 0 NOT NULL,
  "net_pay" numeric(14,2) DEFAULT 0 NOT NULL,
  "employer_statutory_cost" numeric(14,2) DEFAULT 0 NOT NULL,
  "calculation_snapshot" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payroll_items_employee_company_fk" FOREIGN KEY (employee_id, company_id) REFERENCES employees(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT "payroll_items_employee_run_unique" UNIQUE (payroll_run_id, employee_id),
  CONSTRAINT "payroll_items_pkey" PRIMARY KEY (id),
  CONSTRAINT "payroll_items_run_company_fk" FOREIGN KEY (payroll_run_id, company_id) REFERENCES payroll_runs(id, company_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_items_pkey ON public.payroll_items USING btree (id);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_items_employee_run_unique ON public.payroll_items USING btree (payroll_run_id, employee_id);

CREATE INDEX IF NOT EXISTS idx_payroll_items_company_run ON public.payroll_items USING btree (company_id, payroll_run_id);

CREATE TABLE public."payroll_journal_sequences" (
  "company_id" uuid NOT NULL,
  "entry_year" integer NOT NULL,
  "next_number" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "payroll_journal_sequences_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT "payroll_journal_sequences_entry_year_check" CHECK (((entry_year >= 2000) AND (entry_year <= 9999))),
  CONSTRAINT "payroll_journal_sequences_next_number_check" CHECK ((next_number > 0)),
  CONSTRAINT "payroll_journal_sequences_pkey" PRIMARY KEY (company_id, entry_year)
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_journal_sequences_pkey ON public.payroll_journal_sequences USING btree (company_id, entry_year);

CREATE TABLE public."payroll_remittance_obligations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "payroll_run_id" uuid NOT NULL,
  "authority" text NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "due_date" date NOT NULL,
  "amount" numeric(14,2) NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payroll_remittance_obligation_company_id_payroll_run_id_aut_key" UNIQUE (company_id, payroll_run_id, authority),
  CONSTRAINT "payroll_remittance_obligations_amount_check" CHECK ((amount > (0)::numeric)),
  CONSTRAINT "payroll_remittance_obligations_authority_check" CHECK ((authority = ANY (ARRAY['PAYE'::text, 'NSSF'::text, 'SHIF'::text, 'HOUSING_LEVY'::text]))),
  CONSTRAINT "payroll_remittance_obligations_check" CHECK ((period_end >= period_start)),
  CONSTRAINT "payroll_remittance_obligations_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT "payroll_remittance_obligations_id_company_id_key" UNIQUE (id, company_id),
  CONSTRAINT "payroll_remittance_obligations_payroll_run_id_fkey" FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id) ON DELETE RESTRICT,
  CONSTRAINT "payroll_remittance_obligations_pkey" PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_remittance_obligations_pkey ON public.payroll_remittance_obligations USING btree (id);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_remittance_obligation_company_id_payroll_run_id_aut_key ON public.payroll_remittance_obligations USING btree (company_id, payroll_run_id, authority);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_remittance_obligations_id_company_id_key ON public.payroll_remittance_obligations USING btree (id, company_id);

CREATE INDEX IF NOT EXISTS payroll_remittance_obligations_company_due_idx ON public.payroll_remittance_obligations USING btree (company_id, due_date, authority);

CREATE TABLE public."payroll_remittance_payments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "obligation_id" uuid NOT NULL,
  "amount" numeric(14,2) NOT NULL,
  "payment_reference" text NOT NULL,
  "paid_at" timestamp with time zone NOT NULL,
  "receipt_storage_key" text,
  "notes" text,
  "recorded_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payroll_remittance_payments_amount_check" CHECK ((amount > (0)::numeric)),
  CONSTRAINT "payroll_remittance_payments_company_id_payment_reference_key" UNIQUE (company_id, payment_reference),
  CONSTRAINT "payroll_remittance_payments_obligation_id_company_id_fkey" FOREIGN KEY (obligation_id, company_id) REFERENCES payroll_remittance_obligations(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT "payroll_remittance_payments_payment_reference_check" CHECK (((length(TRIM(BOTH FROM payment_reference)) >= 1) AND (length(TRIM(BOTH FROM payment_reference)) <= 160))),
  CONSTRAINT "payroll_remittance_payments_pkey" PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_remittance_payments_pkey ON public.payroll_remittance_payments USING btree (id);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_remittance_payments_company_id_payment_reference_key ON public.payroll_remittance_payments USING btree (company_id, payment_reference);

CREATE INDEX IF NOT EXISTS payroll_remittance_payments_obligation_idx ON public.payroll_remittance_payments USING btree (company_id, obligation_id, paid_at);

ALTER TABLE public.chart_of_accounts ADD COLUMN cash_flow_category VARCHAR(16);

ALTER TABLE public.chart_of_accounts ADD CONSTRAINT chart_of_accounts_cash_flow_category_check CHECK (cash_flow_category IS NULL OR cash_flow_category IN ('operating','investing','financing'));

ALTER TABLE public.journal_entries ADD COLUMN goods_receipt_id UUID;

ALTER TABLE public.journal_entries ADD COLUMN reversal_journal_id UUID;

ALTER TABLE public.journal_entries ADD COLUMN reversed_at TIMESTAMPTZ;

ALTER TABLE public.journal_entries ADD COLUMN reversed_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_goods_receipt_company_fk FOREIGN KEY (goods_receipt_id,company_id) REFERENCES public.goods_receipts(id,company_id) ON DELETE RESTRICT;

ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_reversal_company_fk FOREIGN KEY (reversal_journal_id,company_id) REFERENCES public.journal_entries(id,company_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_reversal_unique ON public.journal_entries(company_id,reversal_journal_id) WHERE reversal_journal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_company_goods_receipt ON public.journal_entries(company_id,goods_receipt_id) WHERE goods_receipt_id IS NOT NULL;

ALTER TABLE public.journal_entry_lines ADD COLUMN cost_centre_id UUID;

ALTER TABLE public.journal_entry_lines ADD CONSTRAINT journal_entry_lines_cost_centre_company_fk FOREIGN KEY (cost_centre_id,company_id) REFERENCES public.cost_centres(id,company_id) ON DELETE RESTRICT;
