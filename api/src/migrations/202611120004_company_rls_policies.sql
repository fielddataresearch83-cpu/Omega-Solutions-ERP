-- Enforce company isolation for every existing RLS-enabled public table that
-- carries company_id. The application sets app.company_id only from a verified
-- server-side authenticated membership. Missing context intentionally matches no rows.
DO $migration$
DECLARE
  target record;
  policy_exists boolean;
BEGIN
  FOR target IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN information_schema.columns col
      ON col.table_schema = n.nspname
     AND col.table_name = c.relname
     AND col.column_name = 'company_id'
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
    ORDER BY c.relname
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target.table_name
        AND policyname = 'omega_company_isolation'
    ) INTO policy_exists;

    IF NOT policy_exists THEN
      EXECUTE format(
        'CREATE POLICY omega_company_isolation ON public.%I USING (company_id = NULLIF(current_setting(''app.company_id'', true), '''')::uuid) WITH CHECK (company_id = NULLIF(current_setting(''app.company_id'', true), '''')::uuid)',
        target.table_name
      );
    END IF;
  END LOOP;
END
$migration$;
