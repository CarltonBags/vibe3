-- =====================================================
-- DIAGNOSTIC QUERIES FOR TROUBLESHOOTING
-- Run these in Supabase SQL Editor to diagnose issues
-- =====================================================

-- 1. Check if pricing_tiers exist and have data
SELECT 'Pricing Tiers Check' as check_name, COUNT(*) as count FROM pricing_tiers;
SELECT * FROM pricing_tiers ORDER BY price_monthly;

-- 2. Check if the trigger exists
SELECT 
  'Trigger Check' as check_name,
  tgname as trigger_name, 
  tgenabled as is_enabled 
FROM pg_trigger 
WHERE tgname = 'on_auth_user_created';

-- 3. Check if the function exists
SELECT 
  'Function Check' as check_name,
  proname as function_name 
FROM pg_proc 
WHERE proname = 'handle_new_user';

-- 4. Check auth.users (should show your failed signup attempt)
SELECT 
  'Auth Users Check' as check_name,
  id, 
  email, 
  created_at,
  raw_user_meta_data
FROM auth.users 
ORDER BY created_at DESC 
LIMIT 5;

-- 5. Check public.users (might be empty if trigger failed)
SELECT 
  'Public Users Check' as check_name,
  COUNT(*) as count 
FROM users;

-- 6. Try to manually trigger the function (if auth user exists)
-- Replace 'YOUR_EMAIL' with the email you tried to sign up with
DO $$
DECLARE
  v_user_id UUID;
  v_free_tier_id UUID;
BEGIN
  -- Get user ID from auth.users
  SELECT id INTO v_user_id 
  FROM auth.users 
  WHERE email = 'test@example.com' -- REPLACE THIS
  LIMIT 1;
  
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'No user found with that email';
    RETURN;
  END IF;
  
  -- Get free tier ID
  SELECT id INTO v_free_tier_id 
  FROM pricing_tiers 
  WHERE name = 'free';
  
  IF v_free_tier_id IS NULL THEN
    RAISE NOTICE 'Free tier not found!';
    RETURN;
  END IF;
  
  -- Try to create user profile
  INSERT INTO public.users (id, email, tier_id, full_name)
  VALUES (
    v_user_id,
    (SELECT email FROM auth.users WHERE id = v_user_id),
    v_free_tier_id,
    'Test User'
  )
  ON CONFLICT (id) DO NOTHING;
  
  RAISE NOTICE 'User profile created successfully!';
END $$;

-- 7. Check for any orphaned auth.users without profiles
SELECT 
  'Orphaned Users' as check_name,
  au.id,
  au.email,
  au.created_at
FROM auth.users au
LEFT JOIN public.users pu ON au.id = pu.id
WHERE pu.id IS NULL;

