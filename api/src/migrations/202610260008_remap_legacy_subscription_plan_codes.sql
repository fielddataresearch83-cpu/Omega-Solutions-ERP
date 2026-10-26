-- Keep existing subscriptions and pending checkout intents aligned with the current plan catalogue.
-- Legacy Business and Enterprise had the same prices and module sets as Medium and Professional.
-- Preserve completed payment records as historical evidence of the plan originally purchased.
WITH legacy_map(old_code, new_code) AS (
  VALUES ('business'::text, 'medium'::text), ('enterprise'::text, 'professional'::text)
)
UPDATE company_subscriptions AS s
SET plan_code = m.new_code,
    updated_at = NOW()
FROM legacy_map AS m
JOIN subscription_plans AS old_plan
  ON old_plan.code = m.old_code
 AND old_plan.is_active = FALSE
JOIN subscription_plans AS new_plan
  ON new_plan.code = m.new_code
 AND new_plan.is_active = TRUE
 AND new_plan.monthly_price_kes = old_plan.monthly_price_kes
 AND new_plan.modules = old_plan.modules
WHERE s.plan_code = m.old_code;

-- Pending checkout links may still be completed. Map only those pending intents to
-- the equivalent active plan so a late successful webhook cannot activate an inactive legacy plan.
WITH legacy_map(old_code, new_code) AS (
  VALUES ('business'::text, 'medium'::text), ('enterprise'::text, 'professional'::text)
)
UPDATE subscription_payments AS sp
SET plan_code = m.new_code,
    updated_at = NOW()
FROM legacy_map AS m
JOIN subscription_plans AS old_plan
  ON old_plan.code = m.old_code
 AND old_plan.is_active = FALSE
JOIN subscription_plans AS new_plan
  ON new_plan.code = m.new_code
 AND new_plan.is_active = TRUE
 AND new_plan.monthly_price_kes = old_plan.monthly_price_kes
 AND new_plan.modules = old_plan.modules
WHERE sp.plan_code = m.old_code
  AND sp.status = 'pending'
  AND sp.amount_kes = new_plan.monthly_price_kes;
