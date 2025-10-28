-- Fix permissions for the user creation trigger

-- 1. Grant necessary permissions (run as service role in Supabase)
-- Note: This should be run with admin privileges

-- Grant permissions on the users table
GRANT ALL ON TABLE public.users TO service_role;
GRANT ALL ON TABLE public.pricing_tiers TO service_role;
GRANT ALL ON TABLE public.user_usage TO service_role;

-- Grant permissions on sequences (note: users table uses UUID, no sequence needed)
-- GRANT ALL ON SEQUENCE public.user_usage_id_seq TO service_role;

-- 2. Alternative: Modify the trigger function to not use SECURITY DEFINER
-- This runs with the privileges of the calling user (which won't work for auth triggers)

-- 3. Check current function definition
SELECT proname, proowner::regrole, prosecdef
FROM pg_proc
WHERE proname = 'handle_new_user';

-- 4. Recreate the function with proper permissions
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tier_id UUID;
BEGIN
  -- Get tier ID (starter preferred, free fallback)
  SELECT id INTO tier_id FROM pricing_tiers WHERE name = 'starter' LIMIT 1;
  IF tier_id IS NULL THEN
    SELECT id INTO tier_id FROM pricing_tiers WHERE name = 'free' LIMIT 1;
  END IF;

  -- Insert user profile
  INSERT INTO public.users (id, email, full_name, tier_id)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), tier_id);

  RETURN NEW;
END;
$$;

-- 5. Ensure the function owner has proper permissions
-- In Supabase, the service role should own the function
ALTER FUNCTION public.handle_new_user() OWNER TO service_role;

-- 6. Verify the trigger is enabled
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;
