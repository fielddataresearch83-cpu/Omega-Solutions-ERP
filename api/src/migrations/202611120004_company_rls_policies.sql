-- Enforce company and (where modeled) branch isolation for every existing
-- RLS-enabled public table carrying company_id. Context is populated only from
-- the verified JWT principal; membership is independently rechecked in SQL.
-- No context or no active membership intentionally returns no rows.
DO $migration$
DECLARE
  target record;
  branch_predicate text;
BEGIN
  FOR target IN
    SELECT c.relname AS table_name,
           EXISTS (
             SELECT 1 FROM information_schema.columns branch_col
             WHERE branch_col.table_schema = 'public'
               AND branch_col.table_name = c.relname
               AND branch_col.column_name = 'branch_id'
           ) AS has_branch_id
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
    branch_predicate := '';
    IF target.has_branch_id THEN
      branch_predicate := format(
        ' AND (%I IS NULL OR m.branch_id IS NULL OR %I = m.branch_id)',
        'branch_id', 'branch_id'
      );
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS omega_company_isolation ON public.%I', target.table_name);
    EXECUTE format(
      'CREATE POLICY omega_company_isolation ON public.%I USING (
        company_id = NULLIF(current_setting(''app.company_id'', true), '''')::uuid
        AND EXISTS (
          SELECT 1 FROM public.company_memberships m
          WHERE m.company_id = company_id
            AND m.user_id = NULLIF(current_setting(''app.user_id'', true), '''')::uuid
            AND m.is_active = true%s
        )
      ) WITH CHECK (
        company_id = NULLIF(current_setting(''app.company_id'', true), '''')::uuid
        AND EXISTS (
          SELECT 1 FROM public.company_memberships m
          WHERE m.company_id = company_id
            AND m.user_id = NULLIF(current_setting(''app.user_id'', true), '''')::uuid
            AND m.is_active = true%s
        )
      )',
      target.table_name, branch_predicate, branch_predicate
    );
  END LOOP;
END
$migration$;
