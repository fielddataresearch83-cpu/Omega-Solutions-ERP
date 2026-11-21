-- Control-plane least-privilege grants.
--
-- Scope: grants only. This migration does NOT enable row-level security, does
-- NOT change any row, and does NOT alter application behaviour. It removes
-- write access to global reference catalogs and all access to the migration
-- ledger from the application role.
--
-- Why grants first: enabling RLS on company_memberships, auth_refresh_tokens,
-- company_invitations, user_mfa, users or companies requires the application to
-- establish a verified identity context before those queries run. Login,
-- registration, refresh, logout and invitation acceptance currently execute
-- before (or outside) tenant context, so enabling RLS on them today would break
-- authentication. See docs/CONTROL_PLANE_AUTHORIZATION.md.
--
-- Ownership caveat: a role that OWNS these tables keeps its privileges; REVOKE
-- has no effect on the owner. The runtime role must therefore not own schema
-- objects for this hardening to be effective. Verify with
-- api/scripts/inspect-database-readonly.mjs (owns_public_tables).

BEGIN;

DO $migration$
DECLARE
  app_role text;
BEGIN
  FOREACH app_role IN ARRAY ARRAY['omega_app_dev', 'omega_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
      -- Global reference data is read-only for the application.
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.permissions, public.role_permissions, public.subscription_plans FROM %I',
        app_role
      );
      EXECUTE format(
        'GRANT SELECT ON public.permissions, public.role_permissions, public.subscription_plans TO %I',
        app_role
      );

      -- The ledger is migration-runner bookkeeping; the application never reads it.
      EXECUTE format('REVOKE ALL ON public.omega_schema_migrations FROM %I', app_role);
    END IF;
  END LOOP;
END
$migration$;

-- Role-agnostic baseline: no non-owner identity should be able to rewrite the
-- global catalogs. Tables created later inherit this only if the creating role's
-- default privileges do not re-grant write access, so verify after DDL changes.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.permissions, public.role_permissions, public.subscription_plans
  FROM PUBLIC;

COMMENT ON TABLE public.permissions IS
  'Global read-only permission catalog. Runtime roles must not hold write privileges.';
COMMENT ON TABLE public.role_permissions IS
  'Global read-only role-to-permission mapping used when assembling JWT claims. Runtime roles must not hold write privileges.';
COMMENT ON TABLE public.subscription_plans IS
  'Global platform pricing catalog. Tenant entitlements live in company_subscriptions, which is RLS-protected. Runtime roles must not hold write privileges.';
COMMENT ON TABLE public.omega_schema_migrations IS
  'Migration-runner ledger. Owner-only; the application runtime role must have no privileges.';

COMMIT;
