-- 202610260004_subscription_tier_restructure.sql
-- Publish the four-tier catalogue while preserving legacy plan rows for existing subscriptions.
-- Legacy subscriptions continue to reference their original plan code and price.
ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS is_custom_pricing BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE subscription_plans
SET is_active = FALSE, updated_at = NOW()
WHERE code IN ('business', 'enterprise');

INSERT INTO subscription_plans
  (code, name, description, monthly_price_kes, max_users, max_branches, modules, is_active, is_custom_pricing)
VALUES
  ('medium', 'Medium', 'Connected sales, stock, finance and customer management for growing businesses', 3000, 5, 3,
   ARRAY['core','inventory','sales','pos','reports','accounting','procurement','crm'], TRUE, FALSE),
  ('professional', 'Professional', 'Advanced operations for established and multi-branch businesses', 6000, 15, 5,
   ARRAY['core','inventory','sales','pos','reports','accounting','procurement','crm','manufacturing','hr_workforce'], TRUE, FALSE),
  ('enterprise_custom', 'Enterprise', 'Custom ERP configuration for complex organisations and multi-entity operations', 0, 50, 10,
   ARRAY['core','inventory','sales','pos','reports','accounting','procurement','crm','manufacturing','hr_workforce'], TRUE, TRUE)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  monthly_price_kes = EXCLUDED.monthly_price_kes,
  max_users = EXCLUDED.max_users,
  max_branches = EXCLUDED.max_branches,
  modules = EXCLUDED.modules,
  is_active = TRUE,
  is_custom_pricing = EXCLUDED.is_custom_pricing,
  updated_at = NOW();

-- Keep the original Starter price and limits unchanged.
UPDATE subscription_plans
SET name = 'Starter',
    description = 'Essential sales and stock control for small businesses',
    is_active = TRUE,
    is_custom_pricing = FALSE,
    updated_at = NOW()
WHERE code = 'starter';
