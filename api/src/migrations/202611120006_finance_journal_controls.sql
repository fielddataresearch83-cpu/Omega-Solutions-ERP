-- Manual journal reversals are additive: original postings remain visible and the reversal posts equal opposite lines.
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS reversal_journal_id UUID,
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_reversal_unique
  ON journal_entries(company_id,reversal_journal_id)
  WHERE reversal_journal_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='journal_entries_reversal_company_fk'
  ) THEN
    ALTER TABLE journal_entries
      ADD CONSTRAINT journal_entries_reversal_company_fk
      FOREIGN KEY(reversal_journal_id,company_id)
      REFERENCES journal_entries(id,company_id) ON DELETE RESTRICT;
  END IF;
END $$;

COMMENT ON COLUMN journal_entries.reversal_journal_id IS
  'Posted reversing journal for this entry. Original and reversal remain posted so their combined ledger impact is zero.';
