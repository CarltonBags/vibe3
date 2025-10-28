-- Quick fix for user signup issue
-- Run this in Supabase SQL Editor to ensure pricing tiers exist

-- Insert the starter tier if it doesn't exist
INSERT INTO pricing_tiers (name, display_name, price_monthly, max_projects, max_generations_per_month, max_tokens_per_generation, sandbox_duration_hours, features, can_export_github, can_use_custom_domain, has_priority_queue, has_api_access, team_seats) VALUES
  ('starter', 'Starter', 15, 10, 40, 100000, 4, '["10 projects", "40 generations per month", "4-hour sandboxes", "No watermark", "Email support"]', false, false, false, false, 0)
ON CONFLICT (name) DO NOTHING;

-- Verify starter tier exists
SELECT name, display_name FROM pricing_tiers WHERE name = 'starter';

-- Update the trigger function to use starter tier
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  starter_tier_id UUID;
BEGIN
  -- Get the starter tier ID
  SELECT id INTO starter_tier_id FROM pricing_tiers WHERE name = 'starter' LIMIT 1;

  -- If starter tier doesn't exist, fall back to free tier
  IF starter_tier_id IS NULL THEN
    SELECT id INTO starter_tier_id FROM pricing_tiers WHERE name = 'free' LIMIT 1;
  END IF;

  -- Insert user profile
  INSERT INTO public.users (id, email, tier_id, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    starter_tier_id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', '')
  );

  -- Create initial usage record for current month
  INSERT INTO public.user_usage (user_id, period_start, period_end)
  VALUES (
    NEW.id,
    DATE_TRUNC('month', NOW()),
    DATE_TRUNC('month', NOW()) + INTERVAL '1 month'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
