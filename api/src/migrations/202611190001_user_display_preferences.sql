-- User display preferences are scoped to both user and active company.
-- This migration is prepared for manual application on an isolated development branch only.
CREATE TABLE IF NOT EXISTS user_display_preferences (
  user_id UUID NOT NULL,
  company_id UUID NOT NULL,
  date_format VARCHAR(30) NOT NULL DEFAULT 'DD MMM YYYY',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, company_id),
  CONSTRAINT user_display_preferences_membership_fk
    FOREIGN KEY (user_id, company_id)
    REFERENCES company_memberships(user_id, company_id) ON DELETE CASCADE,
  CONSTRAINT user_display_preferences_date_format_check
    CHECK (date_format IN ('DD MMM YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'))
);
