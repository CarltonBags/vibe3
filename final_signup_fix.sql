-- Final signup fix - client-side approach
-- This ensures pricing tiers exist and have proper permissions

-- 0. Disable the problematic trigger first
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- 1. Create pricing tiers if they don't exist
INSERT INTO pricing_tiers (name, display_name, price_monthly, max_projects, max_generations_per_month, max_tokens_per_generation, sandbox_duration_hours, features, can_export_github, can_use_custom_domain, has_priority_queue, has_api_access, team_seats) VALUES
  ('free', 'Free', 0, 3, 5, 100000, 1, '["3 projects", "5 generations per month", "1-hour sandboxes", "Community support"]', false, false, false, false, 0),
  ('starter', 'Starter', 15, 10, 40, 100000, 4, '["10 projects", "40 generations per month", "4-hour sandboxes", "No watermark", "Email support"]', false, false, false, false, 0)
ON CONFLICT (name) DO NOTHING;

-- 2. Ensure pricing_tiers can be read by everyone (for tier lookup)
DROP POLICY IF EXISTS "pricing_tiers_select" ON pricing_tiers;
CREATE POLICY "pricing_tiers_select" ON pricing_tiers FOR SELECT USING (true);

-- 3. Allow authenticated users to insert into users table
DROP POLICY IF EXISTS "users_insert" ON users;
CREATE POLICY "users_insert" ON users FOR INSERT WITH CHECK (auth.uid() = id);

-- 4. Verify setup
SELECT 'Signup ready!' as status, COUNT(*) as tiers FROM pricing_tiers WHERE name IN ('free', 'starter');
