-- Quick fix for signup - run this in Supabase SQL Editor

-- 1. Ensure pricing tiers exist (especially starter)
INSERT INTO pricing_tiers (name, display_name, price_monthly, max_projects, max_generations_per_month, max_tokens_per_generation, sandbox_duration_hours, features, can_export_github, can_use_custom_domain, has_priority_queue, has_api_access, team_seats) VALUES
  ('free', 'Free', 0, 3, 5, 100000, 1, '["3 projects", "5 generations per month", "1-hour sandboxes", "Community support"]', false, false, false, false, 0),
  ('starter', 'Starter', 15, 10, 40, 100000, 4, '["10 projects", "40 generations per month", "4-hour sandboxes", "No watermark", "Email support"]', false, false, false, false, 0)
ON CONFLICT (name) DO NOTHING;

-- 2. Create a simple trigger that works
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  tier_id UUID;
BEGIN
  -- Try starter tier first, fallback to free
  SELECT id INTO tier_id FROM pricing_tiers WHERE name = 'starter' LIMIT 1;
  IF tier_id IS NULL THEN
    SELECT id INTO tier_id FROM pricing_tiers WHERE name = 'free' LIMIT 1;
  END IF;

  -- Create user profile
  INSERT INTO public.users (id, email, full_name, tier_id)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), tier_id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Ensure trigger is enabled
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;

-- 4. Verify everything is ready
SELECT 'Ready for signup!' as status, COUNT(*) as tiers FROM pricing_tiers;
