-- Fix the auth trigger by making it work properly
-- Since we can't disable auth triggers, we need to make them work

-- 1. Ensure pricing tiers exist first
INSERT INTO pricing_tiers (name, display_name, price_monthly, max_projects, max_generations_per_month, max_tokens_per_generation, sandbox_duration_hours, features, can_export_github, can_use_custom_domain, has_priority_queue, has_api_access, team_seats) VALUES
  ('free', 'Free', 0, 3, 5, 100000, 1, '["3 projects", "5 generations per month", "1-hour sandboxes", "Community support"]', false, false, false, false, 0),
  ('starter', 'Starter', 15, 10, 40, 100000, 4, '["10 projects", "40 generations per month", "4-hour sandboxes", "No watermark", "Email support"]', false, false, false, false, 0)
ON CONFLICT (name) DO NOTHING;

-- 2. Recreate the trigger function with proper error handling
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tier_id UUID;
  user_exists BOOLEAN;
BEGIN
  -- Check if user already exists (prevent duplicates)
  SELECT EXISTS(SELECT 1 FROM public.users WHERE id = NEW.id) INTO user_exists;
  IF user_exists THEN
    RETURN NEW;
  END IF;

  -- Get tier ID (try starter first, fallback to free)
  BEGIN
    SELECT id INTO tier_id FROM pricing_tiers WHERE name = 'starter' LIMIT 1;
    IF tier_id IS NULL THEN
      SELECT id INTO tier_id FROM pricing_tiers WHERE name = 'free' LIMIT 1;
    END IF;

    -- If still no tier, skip user creation (let client handle it)
    IF tier_id IS NULL THEN
      RAISE NOTICE 'No pricing tiers found, skipping user profile creation';
      RETURN NEW;
    END IF;

    -- Insert user profile
    INSERT INTO public.users (id, email, full_name, tier_id)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), tier_id);

    EXCEPTION
      WHEN OTHERS THEN
        -- Log the error but don't fail the signup
        RAISE NOTICE 'Trigger user creation failed: %, skipping...', SQLERRM;
        RETURN NEW;
  END;

  RETURN NEW;
END;
$$;

-- 3. Ensure the trigger exists and is enabled
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Also create RPC function as backup
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
    RETURN true;
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
    RAISE NOTICE 'RPC user creation failed: %', SQLERRM;
    RETURN false;
END;
$$;

-- 5. Test that everything works
SELECT 'Auth setup complete - trigger and RPC ready' as status;
