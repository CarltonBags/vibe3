-- Simple signup fix - bypass the trigger temporarily
-- This creates users directly without using a trigger

-- 1. Disable the problematic trigger
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;

-- 2. Ensure pricing tiers exist
INSERT INTO pricing_tiers (name, display_name, price_monthly, max_projects, max_generations_per_month, max_tokens_per_generation, sandbox_duration_hours, features, can_export_github, can_use_custom_domain, has_priority_queue, has_api_access, team_seats) VALUES
  ('free', 'Free', 0, 3, 5, 100000, 1, '["3 projects", "5 generations per month", "1-hour sandboxes", "Community support"]', false, false, false, false, 0),
  ('starter', 'Starter', 15, 10, 40, 100000, 4, '["10 projects", "40 generations per month", "4-hour sandboxes", "No watermark", "Email support"]', false, false, false, false, 0)
ON CONFLICT (name) DO NOTHING;

-- 2. Create a simple function to manually create users after signup
-- This can be called from your application after successful signup

CREATE OR REPLACE FUNCTION public.create_user_profile(
  user_id UUID,
  user_email TEXT,
  user_name TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  tier_id UUID;
BEGIN
  -- Check if user already exists
  IF EXISTS (SELECT 1 FROM public.users WHERE id = user_id) THEN
    RETURN true; -- Already exists, nothing to do
  END IF;

  -- Get starter tier, fallback to free
  SELECT id INTO tier_id FROM pricing_tiers WHERE name = 'starter' LIMIT 1;
  IF tier_id IS NULL THEN
    SELECT id INTO tier_id FROM pricing_tiers WHERE name = 'free' LIMIT 1;
  END IF;

  -- Create user profile
  INSERT INTO public.users (id, email, full_name, tier_id)
  VALUES (user_id, user_email, COALESCE(user_name, ''), tier_id);

  RETURN true;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error creating user profile: %', SQLERRM;
    RETURN false;
END;
$$;

-- 3. Test the function
-- SELECT public.create_user_profile('test-uuid'::uuid, 'test@example.com', 'Test User');

-- 4. Alternative: Use Supabase Edge Functions or client-side user creation
-- Instead of a trigger, call this function from your Next.js app after signup

/*
-- In your Next.js app, after successful signup:
import { supabase } from '@/lib/supabase-browser'

const { data, error } = await supabase
  .rpc('create_user_profile', {
    user_id: user.id,
    user_email: user.email,
    user_name: user.user_metadata?.full_name
  })
*/
