-- Enforce tenant and user isolation for personal display preferences.
-- The API sets app.user_id and app.company_id transaction-locally via
-- tenantDatabaseContext before executing tenant-scoped database queries.
ALTER TABLE user_display_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS omega_user_company_isolation ON user_display_preferences;
CREATE POLICY omega_user_company_isolation ON user_display_preferences
  FOR ALL
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM company_memberships m
      WHERE m.user_id = user_display_preferences.user_id
        AND m.company_id = user_display_preferences.company_id
        AND m.is_active = true
    )
  )
  WITH CHECK (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM company_memberships m
      WHERE m.user_id = user_display_preferences.user_id
        AND m.company_id = user_display_preferences.company_id
        AND m.is_active = true
    )
  );

-- The table is created by the previous migration, so a role-wide baseline grant
-- from an earlier migration does not cover it.
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omega_app_dev') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON user_display_preferences TO omega_app_dev';
  END IF;
END
$grants$;
