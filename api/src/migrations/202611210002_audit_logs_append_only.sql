-- Keep the audit trail append-only for application runtime roles.
-- Table owners and database superusers remain privileged; runtime roles must not own it.
BEGIN;

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_logs FROM PUBLIC;

DO $migration$
DECLARE
  app_role text;
BEGIN
  FOREACH app_role IN ARRAY ARRAY['omega_app_dev', 'omega_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
      EXECUTE format(
        'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_logs FROM %I',
        app_role
      );
    END IF;
  END LOOP;
END
$migration$;

COMMENT ON TABLE public.audit_logs IS
  'Append-only audit trail. Runtime application roles may append and read records but must not update, delete or truncate them. Table owner and superuser remain privileged.';

COMMIT;
