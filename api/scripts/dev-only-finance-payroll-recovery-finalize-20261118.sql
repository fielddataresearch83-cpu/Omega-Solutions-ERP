-- DEVELOPMENT ONLY. Run after the preserved records have been imported.
-- Restores post-import foreign keys, account seeds, tenant RLS and app-role grants.
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_account_company_fk;

ALTER TABLE public.expenses ADD CONSTRAINT expenses_account_company_fk FOREIGN KEY (expense_account_id,company_id) REFERENCES public.chart_of_accounts(id,company_id) ON DELETE RESTRICT;

ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_journal_company_fk;

ALTER TABLE public.expenses ADD CONSTRAINT expenses_journal_company_fk FOREIGN KEY (journal_entry_id,company_id) REFERENCES public.journal_entries(id,company_id) ON DELETE RESTRICT;

ALTER TABLE public.manufacturing_order_costs DROP CONSTRAINT IF EXISTS manufacturing_order_cost_account_company_fk;

ALTER TABLE public.manufacturing_order_costs ADD CONSTRAINT manufacturing_order_cost_account_company_fk FOREIGN KEY (source_account_id,company_id) REFERENCES public.chart_of_accounts(id,company_id) ON DELETE RESTRICT;

ALTER TABLE public.manufacturing_order_costs DROP CONSTRAINT IF EXISTS manufacturing_order_cost_journal_company_fk;

ALTER TABLE public.manufacturing_order_costs ADD CONSTRAINT manufacturing_order_cost_journal_company_fk FOREIGN KEY (journal_entry_id,company_id) REFERENCES public.journal_entries(id,company_id) ON DELETE RESTRICT;

ALTER TABLE public.bank_statement_imports DROP CONSTRAINT IF EXISTS bank_statement_imports_account_company_fk;

ALTER TABLE public.bank_statement_imports ADD CONSTRAINT bank_statement_imports_account_company_fk FOREIGN KEY (bank_account_id,company_id) REFERENCES public.chart_of_accounts(id,company_id) ON DELETE RESTRICT;

ALTER TABLE public.bank_statement_lines DROP CONSTRAINT IF EXISTS bank_statement_lines_account_company_fk;

ALTER TABLE public.bank_statement_lines ADD CONSTRAINT bank_statement_lines_account_company_fk FOREIGN KEY (bank_account_id,company_id) REFERENCES public.chart_of_accounts(id,company_id) ON DELETE RESTRICT;

ALTER TABLE public.bank_statement_lines DROP CONSTRAINT IF EXISTS bank_statement_lines_journal_company_fk;

ALTER TABLE public.bank_statement_lines ADD CONSTRAINT bank_statement_lines_journal_company_fk FOREIGN KEY (matched_journal_entry_id,company_id) REFERENCES public.journal_entries(id,company_id) ON DELETE RESTRICT;

ALTER TABLE public.fixed_assets DROP CONSTRAINT IF EXISTS fixed_assets_asset_account_company_fk;

ALTER TABLE public.fixed_assets ADD CONSTRAINT fixed_assets_asset_account_company_fk FOREIGN KEY (asset_account_id,company_id) REFERENCES public.chart_of_accounts(id,company_id) ON DELETE RESTRICT;

ALTER TABLE public.fixed_assets DROP CONSTRAINT IF EXISTS fixed_assets_accumulated_depreciation_account_company_fk;

ALTER TABLE public.fixed_assets ADD CONSTRAINT fixed_assets_accumulated_depreciation_account_company_fk FOREIGN KEY (accumulated_depreciation_account_id,company_id) REFERENCES public.chart_of_accounts(id,company_id) ON DELETE RESTRICT;

ALTER TABLE public.fixed_assets DROP CONSTRAINT IF EXISTS fixed_assets_depreciation_expense_account_company_fk;

ALTER TABLE public.fixed_assets ADD CONSTRAINT fixed_assets_depreciation_expense_account_company_fk FOREIGN KEY (depreciation_expense_account_id,company_id) REFERENCES public.chart_of_accounts(id,company_id) ON DELETE RESTRICT;

ALTER TABLE public.fixed_assets DROP CONSTRAINT IF EXISTS fixed_assets_payment_account_company_fk;

ALTER TABLE public.fixed_assets ADD CONSTRAINT fixed_assets_payment_account_company_fk FOREIGN KEY (payment_account_id,company_id) REFERENCES public.chart_of_accounts(id,company_id) ON DELETE RESTRICT;

ALTER TABLE public.fixed_assets DROP CONSTRAINT IF EXISTS fixed_assets_acquisition_journal_company_fk;

ALTER TABLE public.fixed_assets ADD CONSTRAINT fixed_assets_acquisition_journal_company_fk FOREIGN KEY (acquisition_journal_entry_id,company_id) REFERENCES public.journal_entries(id,company_id) ON DELETE RESTRICT;

ALTER TABLE public.fixed_assets DROP CONSTRAINT IF EXISTS fixed_assets_disposal_journal_company_fk;

ALTER TABLE public.fixed_assets ADD CONSTRAINT fixed_assets_disposal_journal_company_fk FOREIGN KEY (disposal_journal_entry_id,company_id) REFERENCES public.journal_entries(id,company_id) ON DELETE RESTRICT;

ALTER TABLE public.fixed_asset_depreciation DROP CONSTRAINT IF EXISTS fixed_asset_depreciation_journal_company_fk;

ALTER TABLE public.fixed_asset_depreciation ADD CONSTRAINT fixed_asset_depreciation_journal_company_fk FOREIGN KEY (journal_entry_id,company_id) REFERENCES public.journal_entries(id,company_id) ON DELETE RESTRICT;

ALTER TABLE public.budgets DROP CONSTRAINT IF EXISTS budgets_account_company_fk;

ALTER TABLE public.budgets ADD CONSTRAINT budgets_account_company_fk FOREIGN KEY (account_id,company_id) REFERENCES public.chart_of_accounts(id,company_id) ON DELETE RESTRICT;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY omega_company_isolation ON public.audit_logs FOR ALL USING (audit_logs.company_id = NULLIF(current_setting('app.company_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.company_memberships m WHERE m.company_id=audit_logs.company_id AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true AND (audit_logs.branch_id IS NULL OR m.branch_id IS NULL OR audit_logs.branch_id=m.branch_id))) WITH CHECK (audit_logs.company_id = NULLIF(current_setting('app.company_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.company_memberships m WHERE m.company_id=audit_logs.company_id AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true AND (audit_logs.branch_id IS NULL OR m.branch_id IS NULL OR audit_logs.branch_id=m.branch_id)));

GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.audit_logs TO omega_app_dev;

ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY omega_company_isolation ON public.chart_of_accounts FOR ALL USING (chart_of_accounts.company_id = NULLIF(current_setting('app.company_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.company_memberships m WHERE m.company_id=chart_of_accounts.company_id AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true)) WITH CHECK (chart_of_accounts.company_id = NULLIF(current_setting('app.company_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.company_memberships m WHERE m.company_id=chart_of_accounts.company_id AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true));

GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.chart_of_accounts TO omega_app_dev;

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY omega_company_isolation ON public.journal_entries FOR ALL USING (journal_entries.company_id = NULLIF(current_setting('app.company_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.company_memberships m WHERE m.company_id=journal_entries.company_id AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true)) WITH CHECK (journal_entries.company_id = NULLIF(current_setting('app.company_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.company_memberships m WHERE m.company_id=journal_entries.company_id AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true));

GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.journal_entries TO omega_app_dev;

ALTER TABLE public.journal_entry_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY omega_company_isolation ON public.journal_entry_lines FOR ALL USING (journal_entry_lines.company_id = NULLIF(current_setting('app.company_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.company_memberships m WHERE m.company_id=journal_entry_lines.company_id AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true)) WITH CHECK (journal_entry_lines.company_id = NULLIF(current_setting('app.company_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.company_memberships m WHERE m.company_id=journal_entry_lines.company_id AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true));

GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.journal_entry_lines TO omega_app_dev;

ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY omega_company_isolation ON public.payroll_runs FOR ALL USING (payroll_runs.company_id = NULLIF(current_setting('app.company_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.company_memberships m WHERE m.company_id=payroll_runs.company_id AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true)) WITH CHECK (payroll_runs.company_id = NULLIF(current_setting('app.company_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.company_memberships m WHERE m.company_id=payroll_runs.company_id AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true));

GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.payroll_runs TO omega_app_dev;

ALTER TABLE public.payroll_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY omega_company_isolation ON public.payroll_items FOR ALL USING (payroll_items.company_id = NULLIF(current_setting('app.company_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.company_memberships m WHERE m.company_id=payroll_items.company_id AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true)) WITH CHECK (payroll_items.company_id = NULLIF(current_setting('app.company_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.company_memberships m WHERE m.company_id=payroll_items.company_id AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true));

GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.payroll_items TO omega_app_dev;

ALTER TABLE public.payroll_journal_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY omega_company_isolation ON public.payroll_journal_sequences FOR ALL USING (payroll_journal_sequences.company_id = NULLIF(current_setting('app.company_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.company_memberships m WHERE m.company_id=payroll_journal_sequences.company_id AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true)) WITH CHECK (payroll_journal_sequences.company_id = NULLIF(current_setting('app.company_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.company_memberships m WHERE m.company_id=payroll_journal_sequences.company_id AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true));

GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.payroll_journal_sequences TO omega_app_dev;

ALTER TABLE public.payroll_remittance_obligations ENABLE ROW LEVEL SECURITY;

CREATE POLICY omega_company_isolation ON public.payroll_remittance_obligations FOR ALL USING (payroll_remittance_obligations.company_id = NULLIF(current_setting('app.company_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.company_memberships m WHERE m.company_id=payroll_remittance_obligations.company_id AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true)) WITH CHECK (payroll_remittance_obligations.company_id = NULLIF(current_setting('app.company_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.company_memberships m WHERE m.company_id=payroll_remittance_obligations.company_id AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true));

GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.payroll_remittance_obligations TO omega_app_dev;

ALTER TABLE public.payroll_remittance_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY omega_company_isolation ON public.payroll_remittance_payments FOR ALL USING (payroll_remittance_payments.company_id = NULLIF(current_setting('app.company_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.company_memberships m WHERE m.company_id=payroll_remittance_payments.company_id AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true)) WITH CHECK (payroll_remittance_payments.company_id = NULLIF(current_setting('app.company_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.company_memberships m WHERE m.company_id=payroll_remittance_payments.company_id AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.is_active=true));

GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.payroll_remittance_payments TO omega_app_dev;

INSERT INTO public.chart_of_accounts(company_id,code,name,account_type,normal_side,system_code,cash_flow_category)
 SELECT c.id,v.code,v.name,v.account_type,v.normal_side,v.system_code,v.cash_flow_category
 FROM public.companies c CROSS JOIN (VALUES
 ('2050','Customer Credits Payable','liability','credit','customer_credits','operating'),
 ('2060','Withholding Tax Payable','liability','credit','withholding_tax_payable','operating'),
 ('1500','Fixed Assets','asset','debit','fixed_assets','investing'),
 ('1590','Accumulated Depreciation','asset','credit','accumulated_depreciation','investing'),
 ('5220','Depreciation Expense','expense','debit','depreciation_expense','operating'),
 ('4300','Gain on Disposal of Fixed Assets','income','credit','fixed_asset_disposal_gain','investing'),
 ('5300','Loss on Disposal of Fixed Assets','expense','debit','fixed_asset_disposal_loss','investing')
 ) AS v(code,name,account_type,normal_side,system_code,cash_flow_category) ON CONFLICT DO NOTHING;

UPDATE public.chart_of_accounts SET cash_flow_category=CASE
 WHEN system_code IN ('accounts_receivable','accounts_payable','inventory','work_in_progress','input_tax','output_tax','goods_received_not_invoiced','customer_credits') THEN 'operating'
 WHEN system_code='equity' THEN 'financing'
 WHEN system_code IN ('sales_revenue','purchases_expense','operating_expense') THEN 'operating'
 ELSE cash_flow_category END WHERE cash_flow_category IS NULL;
