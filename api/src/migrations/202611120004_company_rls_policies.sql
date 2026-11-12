-- Enforce company and branch isolation on company-owned business tables.
-- Memberships and auth bootstrap tokens/invitations remain control-plane tables:
-- auth resolves membership before a company-scoped JWT context exists.
-- Missing tenant context or inactive membership intentionally matches no rows.
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
      AND c.relname NOT IN ('company_memberships', 'auth_refresh_tokens', 'company_invitations')
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.table_name);
    branch_predicate := '';
    IF target.has_branch_id THEN
      branch_predicate := format(
        ' AND (%I.branch_id IS NULL OR m.branch_id IS NULL OR %I.branch_id = m.branch_id)',
        target.table_name, target.table_name
      );
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS omega_company_isolation ON public.%I', target.table_name);
    EXECUTE format(
      'CREATE POLICY omega_company_isolation ON public.%I USING (
        %I.company_id = NULLIF(current_setting(''app.company_id'', true), '''')::uuid
        AND EXISTS (
          SELECT 1 FROM public.company_memberships m
          WHERE m.company_id = %I.company_id
            AND m.user_id = NULLIF(current_setting(''app.user_id'', true), '''')::uuid
            AND m.is_active = true%s
        )
      ) WITH CHECK (
        %I.company_id = NULLIF(current_setting(''app.company_id'', true), '''')::uuid
        AND EXISTS (
          SELECT 1 FROM public.company_memberships m
          WHERE m.company_id = %I.company_id
            AND m.user_id = NULLIF(current_setting(''app.user_id'', true), '''')::uuid
            AND m.is_active = true%s
        )
      )',
      target.table_name,
      target.table_name, target.table_name, branch_predicate,
      target.table_name, target.table_name, branch_predicate
    );
  END LOOP;
END
$migration$;
