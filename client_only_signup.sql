-- Client-side only signup fix
-- No triggers, just proper permissions for client-side profile creation

-- 1. Ensure pricing tiers exist
INSERT INTO pricing_tiers (name, display_name, price_monthly, max_projects, max_generations_per_month, max_tokens_per_generation, sandbox_duration_hours, features, can_export_github, can_use_custom_domain, has_priority_queue, has_api_access, team_seats) VALUES
  ('free', 'Free', 0, 3, 5, 100000, 1, '["3 projects", "5 generations per month", "1-hour sandboxes", "Community support"]', false, false, false, false, 0),
  ('starter', 'Starter', 15, 10, 40, 100000, 4, '["10 projects", "40 generations per month", "4-hour sandboxes", "No watermark", "Email support"]', false, false, false, false, 0)
ON CONFLICT (name) DO NOTHING;

-- 2. Allow public read access to pricing tiers (for tier lookup)
DROP POLICY IF EXISTS "pricing_tiers_public_read" ON pricing_tiers;
CREATE POLICY "pricing_tiers_public_read" ON pricing_tiers FOR SELECT USING (true);

-- 3. Allow authenticated users to insert their own user profiles
DROP POLICY IF EXISTS "users_self_insert" ON users;
CREATE POLICY "users_self_insert" ON users FOR INSERT WITH CHECK (auth.uid() = id);

-- 4. Also allow updates to own profile
DROP POLICY IF EXISTS "users_self_update" ON users;
CREATE POLICY "users_self_update" ON users FOR UPDATE USING (auth.uid() = id);

-- 5. Create RPC function as additional backup
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

-- 6. Disable any existing problematic triggers (if possible)
-- Note: This might fail in Supabase, that's OK
DO $$
BEGIN
  ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Cannot disable auth trigger (expected in Supabase)';
END $$;

-- 7. Verify setup
SELECT
  'Client-side signup ready!' as status,
  COUNT(*) as pricing_tiers,
  CASE WHEN COUNT(*) >= 2 THEN '✅' ELSE '❌' END as tier_check
FROM pricing_tiers
WHERE name IN ('free', 'starter');
