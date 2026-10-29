-- 202610290001_crm_activity_reminders.sql
-- Idempotency ledger for scheduled in-app CRM activity reminders.
CREATE TABLE IF NOT EXISTS crm_activity_reminder_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_id UUID NOT NULL REFERENCES crm_activities(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reminder_type VARCHAR(20) NOT NULL CHECK (reminder_type IN ('due_soon', 'overdue')),
  due_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT crm_activity_reminder_delivery_once UNIQUE (activity_id, reminder_type, due_at)
);
CREATE INDEX IF NOT EXISTS idx_crm_activity_reminders_due
  ON crm_activities (due_at, company_id)
  WHERE completed_at IS NULL AND due_at IS NOT NULL;
ALTER TABLE crm_activity_reminder_deliveries ENABLE ROW LEVEL SECURITY;
