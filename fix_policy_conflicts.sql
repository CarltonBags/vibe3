-- Quick fix for policy conflicts when running restore_database_schema.sql
-- Run this first if you get "policy already exists" errors

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Users can view own profile" ON users;
DROP POLICY IF EXISTS "Users can update own profile" ON users;

DROP POLICY IF EXISTS "Users can view own projects" ON projects;
DROP POLICY IF EXISTS "Users can insert own projects" ON projects;
DROP POLICY IF EXISTS "Users can update own projects" ON projects;
DROP POLICY IF EXISTS "Users can delete own projects" ON projects;

DROP POLICY IF EXISTS "Users can view own project files" ON project_files;
DROP POLICY IF EXISTS "Users can insert own project files" ON project_files;
DROP POLICY IF EXISTS "Users can update own project files" ON project_files;
DROP POLICY IF EXISTS "Users can delete own project files" ON project_files;

DROP POLICY IF EXISTS "Pricing tiers are publicly readable" ON pricing_tiers;

DROP POLICY IF EXISTS "Users can view own usage" ON user_usage;
DROP POLICY IF EXISTS "Users can insert own usage" ON user_usage;
DROP POLICY IF EXISTS "Users can update own usage" ON user_usage;

DROP POLICY IF EXISTS "Users can view own generations" ON generations;

-- Now you can safely run restore_database_schema.sql
