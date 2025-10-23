-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- PRICING TIERS TABLE
-- =====================================================
CREATE TABLE pricing_tiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  price_monthly INTEGER NOT NULL DEFAULT 0, -- in cents
  max_projects INTEGER NOT NULL DEFAULT -1, -- -1 = unlimited
  max_generations_per_month INTEGER NOT NULL DEFAULT -1,
  max_tokens_per_generation INTEGER NOT NULL DEFAULT 6000,
  sandbox_duration_hours INTEGER NOT NULL DEFAULT 2,
  features JSONB DEFAULT '[]'::jsonb,
  can_export_github BOOLEAN DEFAULT false,
  can_use_custom_domain BOOLEAN DEFAULT false,
  has_priority_queue BOOLEAN DEFAULT false,
  has_api_access BOOLEAN DEFAULT false,
  team_seats INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default pricing tiers
INSERT INTO pricing_tiers (name, display_name, price_monthly, max_projects, max_generations_per_month, max_tokens_per_generation, sandbox_duration_hours, features, can_export_github, can_use_custom_domain, has_priority_queue, has_api_access, team_seats) VALUES
('free', 'Free Vibe', 0, 3, 3, 4000, 1, 
  '["3 generations per month", "1-hour sandboxes", "Community support"]'::jsonb, 
  false, false, false, false, 1),
  
('starter', 'Starter Vibe', 1500, 10, 40, 6000, 4, 
  '["40 generations per month", "4-hour sandboxes", "No watermark", "Email support"]'::jsonb, 
  false, false, false, false, 1),
  
('pro', 'Pro Vibe', 4900, 50, 200, 8000, 12, 
  '["200 generations per month", "12-hour sandboxes", "GitHub export", "Custom domains", "Priority queue", "API access (100 calls/day)", "Priority support"]'::jsonb, 
  true, true, true, true, 1),
  
('team', 'Team Vibe', 14900, -1, 1000, 10000, 24, 
  '["1,000 generations per month", "24-hour sandboxes", "10 team seats", "Unlimited projects", "Unlimited API calls", "White-label option", "Dedicated support"]'::jsonb, 
  true, true, true, true, 10),
  
('enterprise', 'Enterprise Vibe', 99900, -1, -1, 15000, 168, 
  '["Unlimited generations", "7-day sandboxes", "Custom team size", "Self-hosted option", "SLA guarantees", "Dedicated account manager"]'::jsonb, 
  true, true, true, true, -1);

-- =====================================================
-- USERS TABLE (extends Supabase Auth)
-- =====================================================
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  tier_id UUID REFERENCES pricing_tiers(id) NOT NULL,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  subscription_status TEXT CHECK (subscription_status IN ('active', 'canceled', 'past_due', 'trialing')),
  subscription_end_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- PROJECTS TABLE
-- =====================================================
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  prompt TEXT NOT NULL,
  sandbox_id TEXT,
  preview_url TEXT,
  preview_token TEXT,
  status TEXT CHECK (status IN ('generating', 'active', 'archived', 'error')) DEFAULT 'generating',
  last_generated_at TIMESTAMP WITH TIME ZONE,
  generation_count INTEGER DEFAULT 1,
  is_public BOOLEAN DEFAULT false,
  github_repo_url TEXT,
  custom_domain TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_created_at ON projects(created_at DESC);

-- =====================================================
-- PROJECT FILES TABLE
-- =====================================================
CREATE TABLE project_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  file_path TEXT NOT NULL,
  file_content TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(project_id, file_path)
);

-- Index for faster file lookups
CREATE INDEX idx_project_files_project_id ON project_files(project_id);

-- =====================================================
-- USER USAGE TABLE
-- =====================================================
CREATE TABLE user_usage (
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

-- Index for usage queries
CREATE INDEX idx_user_usage_user_id ON user_usage(user_id);
CREATE INDEX idx_user_usage_period ON user_usage(period_start, period_end);

-- =====================================================
-- GENERATIONS TABLE (Audit Log)
-- =====================================================
CREATE TABLE generations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  prompt TEXT NOT NULL,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0, -- in cents
  duration_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT CHECK (status IN ('success', 'error')) NOT NULL,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for analytics
CREATE INDEX idx_generations_user_id ON generations(user_id);
CREATE INDEX idx_generations_created_at ON generations(created_at DESC);
CREATE INDEX idx_generations_status ON generations(status);

-- =====================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_tiers ENABLE ROW LEVEL SECURITY;

-- Pricing tiers: Everyone can read
CREATE POLICY "Pricing tiers are viewable by everyone"
  ON pricing_tiers FOR SELECT
  USING (true);

-- Users: Can only view/update their own profile
CREATE POLICY "Users can view own profile"
  ON users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (auth.uid() = id);

-- Projects: Users can only access their own projects (or public ones)
CREATE POLICY "Users can view own projects"
  ON projects FOR SELECT
  USING (auth.uid() = user_id OR is_public = true);

CREATE POLICY "Users can create own projects"
  ON projects FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own projects"
  ON projects FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own projects"
  ON projects FOR DELETE
  USING (auth.uid() = user_id);

-- Project Files: Users can only access files of their own projects
CREATE POLICY "Users can view files of own projects"
  ON project_files FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_files.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create files in own projects"
  ON project_files FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_files.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update files in own projects"
  ON project_files FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_files.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete files in own projects"
  ON project_files FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_files.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- User Usage: Users can only view their own usage
CREATE POLICY "Users can view own usage"
  ON user_usage FOR SELECT
  USING (auth.uid() = user_id);

-- Generations: Users can only view their own generations
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

-- Function to automatically create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  free_tier_id UUID;
BEGIN
  -- Get the free tier ID
  SELECT id INTO free_tier_id FROM pricing_tiers WHERE name = 'free' LIMIT 1;
  
  -- Insert user profile
  INSERT INTO public.users (id, email, tier_id, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    free_tier_id,
    NEW.raw_user_meta_data->>'full_name'
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
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

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

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX idx_users_tier_id ON users(tier_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_stripe_customer_id ON users(stripe_customer_id);

