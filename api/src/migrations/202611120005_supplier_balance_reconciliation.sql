-- Reconcile the supplier master balance with the authoritative open supplier bills.
-- Safe to rerun; void bills are excluded and payment history remains untouched.
UPDATE suppliers s
SET outstanding_balance = COALESCE((
  SELECT SUM(GREATEST(0, b.total - b.paid_amount))
  FROM supplier_bills b
  WHERE b.company_id = s.company_id
    AND b.supplier_id = s.id
    AND b.status <> 'void'
), 0),
updated_at = NOW();
