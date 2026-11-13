-- Idempotent delivery ledger for company-scoped calendar event reminders.
CREATE TABLE IF NOT EXISTS project_event_reminder_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES project_events(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT project_event_reminder_delivery_once UNIQUE (event_id, user_id, start_at)
);
CREATE INDEX IF NOT EXISTS idx_project_event_reminder_due
  ON project_events (start_at, company_id)
  WHERE reminder_enabled = TRUE AND is_cancelled = FALSE;
ALTER TABLE project_event_reminder_deliveries ENABLE ROW LEVEL SECURITY;
