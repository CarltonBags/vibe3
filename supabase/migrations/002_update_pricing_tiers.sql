-- =====================================================
-- UPDATE PRICING TIERS - Redesigned for Profitability
-- Run this in Supabase SQL Editor
-- =====================================================

-- Update STARTER (Free) Tier
UPDATE pricing_tiers SET
  display_name = 'Starter',
  price_monthly = 0,
  max_generations_per_month = 5,
  max_projects = 2,
  max_tokens_per_generation = 5000,
  sandbox_duration_hours = 0.5,
  features = '[
    "5 generations per month",
    "2 active projects",
    "30-minute sandboxes",
    "5,000 tokens per generation",
    "Community support"
  ]'::jsonb,
  can_export_github = false,
  can_use_custom_domain = false,
  has_priority_queue = false,
  has_api_access = false,
  team_seats = 1
WHERE name = 'free';

-- Update CREATOR ($19/mo) Tier
UPDATE pricing_tiers SET
  display_name = 'Creator',
  price_monthly = 19,
  max_generations_per_month = 50,
  max_projects = 15,
  max_tokens_per_generation = 12000,
  sandbox_duration_hours = 2,
  features = '[
    "50 generations per month",
    "15 active projects",
    "2-hour sandboxes",
    "12,000 tokens per generation",
    "GitHub export",
    "Version history (30 days)",
    "Email support"
  ]'::jsonb,
  can_export_github = true,
  can_use_custom_domain = false,
  has_priority_queue = false,
  has_api_access = false,
  team_seats = 1
WHERE name = 'starter';

-- Update PROFESSIONAL ($49/mo) Tier
UPDATE pricing_tiers SET
  display_name = 'Professional',
  price_monthly = 49,
  max_generations_per_month = 200,
  max_projects = 50,
  max_tokens_per_generation = 20000,
  sandbox_duration_hours = 6,
  features = '[
    "200 generations per month",
    "50 active projects",
    "6-hour sandboxes",
    "20,000 tokens per generation",
    "GitHub auto-sync",
    "Custom domains (up to 3)",
    "Priority queue (2x faster)",
    "Version history (90 days)",
    "Priority support (24h)",
    "API access (coming soon)"
  ]'::jsonb,
  can_export_github = true,
  can_use_custom_domain = true,
  has_priority_queue = true,
  has_api_access = false,
  team_seats = 1
WHERE name = 'pro';

-- Update TEAM ($99/mo) Tier
UPDATE pricing_tiers SET
  display_name = 'Team',
  price_monthly = 99,
  max_generations_per_month = 500,
  max_projects = 999999,
  max_tokens_per_generation = 32000,
  sandbox_duration_hours = 24,
  features = '[
    "500 generations per month",
    "Unlimited projects",
    "24-hour sandboxes",
    "32,000 tokens per generation",
    "3 team seats included",
    "GitHub organization integration",
    "Unlimited custom domains",
    "Priority queue (3x faster)",
    "Shared component library",
    "Team collaboration tools",
    "Priority support (12h)",
    "API access (10,000 calls/mo)",
    "Version history (1 year)"
  ]'::jsonb,
  can_export_github = true,
  can_use_custom_domain = true,
  has_priority_queue = true,
  has_api_access = true,
  team_seats = 3
WHERE name = 'team';

-- Update ENTERPRISE (Custom) Tier
UPDATE pricing_tiers SET
  display_name = 'Enterprise',
  price_monthly = 299,
  max_generations_per_month = 999999,
  max_projects = 999999,
  max_tokens_per_generation = 64000,
  sandbox_duration_hours = 48,
  features = '[
    "Unlimited generations (fair use)",
    "Unlimited projects",
    "48-hour sandboxes",
    "64,000 tokens per generation",
    "Unlimited team seats",
    "White-label option",
    "Custom integrations",
    "Private Daytona cluster (optional)",
    "Dedicated support (4h SLA)",
    "Custom training on your brand",
    "SSO/SAML authentication",
    "Unlimited API access",
    "Custom contract terms"
  ]'::jsonb,
  can_export_github = true,
  can_use_custom_domain = true,
  has_priority_queue = true,
  has_api_access = true,
  team_seats = 999999
WHERE name = 'enterprise';

-- Verify updates
SELECT 
  name,
  display_name,
  price_monthly,
  max_generations_per_month,
  max_projects,
  max_tokens_per_generation,
  sandbox_duration_hours,
  team_seats
FROM pricing_tiers
ORDER BY price_monthly;

-- Done!
SELECT '✅ Pricing tiers updated successfully!' as status;

