-- Debug the signup issue - check if all required components exist

-- 1. Check if pricing_tiers table exists and has starter tier
SELECT 'pricing_tiers table exists' as check_name, COUNT(*) as count FROM information_schema.tables WHERE table_name = 'pricing_tiers' AND table_schema = 'public';
SELECT 'starter tier exists' as check_name, COUNT(*) as count FROM pricing_tiers WHERE name = 'starter';
SELECT 'starter tier details' as check_name, name, display_name FROM pricing_tiers WHERE name = 'starter';

-- 2. Check if users table exists
SELECT 'users table exists' as check_name, COUNT(*) as count FROM information_schema.tables WHERE table_name = 'users' AND table_schema = 'public';

-- 3. Check if user_usage table exists
SELECT 'user_usage table exists' as check_name, COUNT(*) as count FROM information_schema.tables WHERE table_name = 'user_usage' AND table_schema = 'public';

-- 4. Check if trigger exists
SELECT 'trigger exists' as check_name, COUNT(*) as count FROM pg_trigger WHERE tgname = 'on_auth_user_created';

-- 5. Check if function exists
SELECT 'function exists' as check_name, COUNT(*) as count FROM pg_proc WHERE proname = 'handle_new_user';

-- 6. Test the trigger function manually (replace with a test UUID)
-- SELECT public.handle_new_user() as test_result;

-- 7. Check RLS policies
SELECT 'users policies' as check_name, COUNT(*) as count FROM pg_policies WHERE tablename = 'users';
SELECT 'user_usage policies' as check_name, COUNT(*) as count FROM pg_policies WHERE tablename = 'user_usage';

-- 8. Quick fix: Temporarily disable the trigger to test if auth works
-- ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;

-- 9. Alternative: Simplify the trigger function to debug
/*
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Simple version for debugging - just insert with free tier
  INSERT INTO public.users (id, email, full_name, tier_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    (SELECT id FROM pricing_tiers WHERE name = 'free' LIMIT 1)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
*/

-- 10. Re-enable trigger after testing
-- ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;
