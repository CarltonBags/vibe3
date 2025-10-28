-- 🚨 Restore Database Schema After Clearing
-- Run this after running clear_database.sql to restore all policies, triggers, and configurations

-- =====================================================
-- POLICIES (Row Level Security)
-- =====================================================

-- Create missing tables if they don't exist
CREATE TABLE IF NOT EXISTS user_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  period_start TIMESTAMP WITH TIME ZONE NOT NULL,
  period_end TIMESTAMP WITH TIME ZONE NOT NULL,
  generations_used INTEGER DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  projects_created INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, period_start)
);

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_usage ENABLE ROW LEVEL SECURITY;

-- Users: Users can only view/edit their own profile
DROP POLICY IF EXISTS "Users can view own profile" ON users;
CREATE POLICY "Users can view own profile"
  ON users FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON users;
CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (auth.uid() = id);

-- Projects: Users can only view/edit their own projects
DROP POLICY IF EXISTS "Users can view own projects" ON projects;
CREATE POLICY "Users can view own projects"
  ON projects FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own projects" ON projects;
CREATE POLICY "Users can insert own projects"
  ON projects FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own projects" ON projects;
CREATE POLICY "Users can update own projects"
  ON projects FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own projects" ON projects;
CREATE POLICY "Users can delete own projects"
  ON projects FOR DELETE
  USING (auth.uid() = user_id);

-- Project Files: Users can only access files from their own projects
DROP POLICY IF EXISTS "Users can view own project files" ON project_files;
CREATE POLICY "Users can view own project files"
  ON project_files FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_files.project_id
      AND projects.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert own project files" ON project_files;
CREATE POLICY "Users can insert own project files"
  ON project_files FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_files.project_id
      AND projects.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update own project files" ON project_files;
CREATE POLICY "Users can update own project files"
  ON project_files FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_files.project_id
      AND projects.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete own project files" ON project_files;
CREATE POLICY "Users can delete own project files"
  ON project_files FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_files.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- Pricing Tiers: Public read access
DROP POLICY IF EXISTS "Pricing tiers are publicly readable" ON pricing_tiers;
CREATE POLICY "Pricing tiers are publicly readable"
  ON pricing_tiers FOR SELECT
  USING (true);

-- User Usage: Users can only view their own usage
DROP POLICY IF EXISTS "Users can view own usage" ON user_usage;
CREATE POLICY "Users can view own usage"
  ON user_usage FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own usage" ON user_usage;
CREATE POLICY "Users can insert own usage"
  ON user_usage FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own usage" ON user_usage;
CREATE POLICY "Users can update own usage"
  ON user_usage FOR UPDATE
  USING (auth.uid() = user_id);

-- Generations: Users can only view their own generations
DROP POLICY IF EXISTS "Users can view own generations" ON generations;
CREATE POLICY "Users can view own generations"
  ON generations FOR SELECT
  USING (auth.uid() = user_id);

-- =====================================================
-- FUNCTIONS AND TRIGGERS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pricing_tiers_updated_at
  BEFORE UPDATE ON pricing_tiers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_usage_updated_at
  BEFORE UPDATE ON user_usage
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Indexes for user_usage
CREATE INDEX IF NOT EXISTS idx_user_usage_user_id ON user_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_user_usage_period ON user_usage(period_start, period_end);

-- Function to automatically create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  starter_tier_id UUID;
BEGIN
  -- Get the starter tier ID
  SELECT id INTO starter_tier_id FROM pricing_tiers WHERE name = 'starter' LIMIT 1;

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

-- Trigger to create user profile on signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to check if user has exceeded limits
CREATE OR REPLACE FUNCTION check_user_limits(p_user_id UUID)
RETURNS TABLE(
  can_generate BOOLEAN,
  reason TEXT,
  generations_remaining INTEGER,
  projects_remaining INTEGER
) AS $$
DECLARE
  v_tier_id UUID;
  v_max_gens INTEGER;
  v_max_projects INTEGER;
  v_gens_used INTEGER;
  v_projects_count INTEGER;
  v_period_start TIMESTAMP;
BEGIN
  -- Get user's tier and limits
  SELECT u.tier_id, pt.max_generations_per_month, pt.max_projects
  INTO v_tier_id, v_max_gens, v_max_projects
  FROM users u
  JOIN pricing_tiers pt ON u.tier_id = pt.id
  WHERE u.id = p_user_id;

  -- Get current period start
  v_period_start := DATE_TRUNC('month', NOW());

  -- Get current usage
  SELECT COALESCE(uu.generations_used, 0), COALESCE(uu.projects_created, 0)
  INTO v_gens_used, v_projects_count
  FROM user_usage uu
  WHERE uu.user_id = p_user_id
  AND uu.period_start = v_period_start;

  -- If no usage record exists, create one
  IF NOT FOUND THEN
    INSERT INTO user_usage (user_id, period_start, period_end, generations_used, projects_created)
    VALUES (p_user_id, v_period_start, v_period_start + INTERVAL '1 month', 0, 0);
    v_gens_used := 0;
    v_projects_count := 0;
  END IF;

  -- Check generation limit
  IF v_max_gens != -1 AND v_gens_used >= v_max_gens THEN
    RETURN QUERY SELECT false, 'Generation limit exceeded for this month'::TEXT, 0,
      CASE WHEN v_max_projects = -1 THEN -1 ELSE GREATEST(0, v_max_projects - v_projects_count) END;
    RETURN;
  END IF;

  -- Check project limit
  IF v_max_projects != -1 AND v_projects_count >= v_max_projects THEN
    RETURN QUERY SELECT false, 'Project limit exceeded'::TEXT,
      CASE WHEN v_max_gens = -1 THEN -1 ELSE GREATEST(0, v_max_gens - v_gens_used) END, 0;
    RETURN;
  END IF;

  -- All good!
  RETURN QUERY SELECT true, 'OK'::TEXT,
    CASE WHEN v_max_gens = -1 THEN -1 ELSE GREATEST(0, v_max_gens - v_gens_used) END,
    CASE WHEN v_max_projects = -1 THEN -1 ELSE GREATEST(0, v_max_projects - v_projects_count) END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to increment usage
CREATE OR REPLACE FUNCTION increment_user_usage(
  p_user_id UUID,
  p_tokens INTEGER DEFAULT 0,
  p_is_new_project BOOLEAN DEFAULT false
)
RETURNS VOID AS $$
DECLARE
  v_period_start TIMESTAMP;
BEGIN
  v_period_start := DATE_TRUNC('month', NOW());

  INSERT INTO user_usage (user_id, period_start, period_end, generations_used, tokens_used, projects_created)
  VALUES (
    p_user_id,
    v_period_start,
    v_period_start + INTERVAL '1 month',
    1,
    p_tokens,
    CASE WHEN p_is_new_project THEN 1 ELSE 0 END
  )
  ON CONFLICT (user_id, period_start)
  DO UPDATE SET
    generations_used = user_usage.generations_used + 1,
    tokens_used = user_usage.tokens_used + p_tokens,
    projects_created = user_usage.projects_created + CASE WHEN p_is_new_project THEN 1 ELSE 0 END,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to track user usage
CREATE OR REPLACE FUNCTION public.track_user_usage()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert or update user usage record
  INSERT INTO public.user_usage (user_id, period_start, period_end, generations_used, projects_created, tokens_used)
  VALUES (
    NEW.user_id,
    date_trunc('month', CURRENT_DATE),
    (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::date,
    1,
    CASE WHEN NEW.project_id IS NOT NULL THEN 1 ELSE 0 END,
    NEW.tokens_used
  )
  ON CONFLICT (user_id, period_start)
  DO UPDATE SET
    generations_used = user_usage.generations_used + 1,
    projects_created = user_usage.projects_created + CASE WHEN NEW.project_id IS NOT NULL THEN 1 ELSE 0 END,
    tokens_used = user_usage.tokens_used + NEW.tokens_used,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to track usage on new generations
CREATE TRIGGER track_generation_usage
  AFTER INSERT ON generations
  FOR EACH ROW EXECUTE FUNCTION public.track_user_usage();

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_users_tier_id ON users(tier_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);

-- =====================================================
-- DEFAULT DATA
-- =====================================================

-- Add missing columns if they don't exist
ALTER TABLE projects ADD COLUMN IF NOT EXISTS build_hash TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS build_version INTEGER DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS storage_path TEXT;

-- Insert pricing tiers
INSERT INTO pricing_tiers (name, display_name, price_monthly, max_projects, max_generations_per_month, max_tokens_per_generation, sandbox_duration_hours, features, can_export_github, can_use_custom_domain, has_priority_queue, has_api_access, team_seats) VALUES
  ('free', 'Free', 0, 3, 5, 100000, 1, '["3 projects", "5 generations per month", "1-hour sandboxes", "Community support"]', false, false, false, false, 0),
  ('starter', 'Starter', 15, 10, 40, 100000, 4, '["10 projects", "40 generations per month", "4-hour sandboxes", "No watermark", "Email support"]', false, false, false, false, 0),
  ('pro', 'Pro', 19, 50, 200, 100000, 4, '["50 projects", "200 generations per month", "4-hour sandboxes", "No watermark", "Email support"]', false, false, false, false, 0),
  ('team', 'Team', 49, 200, 1000, 100000, 12, '["200 projects", "1,000 generations per month", "12-hour sandboxes", "GitHub export", "Custom domains", "Priority queue", "API access (100 calls/day)", "Priority support"]', true, true, true, true, 0),
  ('enterprise', 'Enterprise', 99, 999999, 999999, 100000, 24, '["Unlimited projects", "Unlimited generations", "7-day sandboxes", "Custom team size", "Self-hosted option", "SLA guarantees", "Unlimited API calls", "White-label option", "Dedicated account manager"]', true, true, true, true, 5)
ON CONFLICT (name) DO NOTHING;

-- Verify restoration
SELECT
  'users' as table_name, COUNT(*) as policies FROM pg_policies WHERE tablename = 'users'
UNION ALL
SELECT 'projects', COUNT(*) FROM pg_policies WHERE tablename = 'projects'
UNION ALL
SELECT 'project_files', COUNT(*) FROM pg_policies WHERE tablename = 'project_files'
UNION ALL
SELECT 'user_usage', COUNT(*) FROM pg_policies WHERE tablename = 'user_usage'
UNION ALL
SELECT 'generations', COUNT(*) FROM pg_policies WHERE tablename = 'generations'
ORDER BY table_name;
