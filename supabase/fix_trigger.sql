-- =====================================================
-- FIX: "Database error saving new user"
-- Run this in Supabase SQL Editor if signup fails
-- =====================================================

-- Drop and recreate the function with better error handling
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Recreate function with better error handling
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  free_tier_id UUID;
BEGIN
  -- Log the attempt
  RAISE LOG 'Creating user profile for: %', NEW.email;
  
  -- Get the free tier ID (with error check)
  SELECT id INTO free_tier_id FROM public.pricing_tiers WHERE name = 'free' LIMIT 1;
  
  IF free_tier_id IS NULL THEN
    RAISE EXCEPTION 'Free tier not found in pricing_tiers table';
  END IF;
  
  -- Insert user profile with error handling
  BEGIN
    INSERT INTO public.users (id, email, tier_id, full_name)
    VALUES (
      NEW.id,
      NEW.email,
      free_tier_id,
      COALESCE(NEW.raw_user_meta_data->>'full_name', NULL)
    );
    
    RAISE LOG 'User profile created for: %', NEW.email;
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'Failed to create user profile: %', SQLERRM;
    RAISE;
  END;
  
  -- Create initial usage record
  BEGIN
    INSERT INTO public.user_usage (user_id, period_start, period_end)
    VALUES (
      NEW.id,
      DATE_TRUNC('month', NOW()),
      DATE_TRUNC('month', NOW()) + INTERVAL '1 month'
    );
    
    RAISE LOG 'Usage record created for: %', NEW.email;
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'Failed to create usage record: %', SQLERRM;
    RAISE;
  END;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Verify trigger was created
SELECT 
  tgname as trigger_name, 
  tgenabled as enabled,
  proname as function_name
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE t.tgname = 'on_auth_user_created';

-- Test: Check pricing_tiers
SELECT 'Pricing tiers check:' as status, COUNT(*) as count FROM pricing_tiers;
SELECT * FROM pricing_tiers WHERE name = 'free';

-- Done!
SELECT '✅ Trigger fixed! Try signup again.' as status;

