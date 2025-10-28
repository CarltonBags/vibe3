-- 🚨 DANGER: This will completely clear your database!
-- Run this ONLY if you want to start completely fresh

-- Disable foreign key checks temporarily
SET session_replication_role = 'replica';

-- Clear all tables in dependency order (reverse of creation)
TRUNCATE TABLE project_files CASCADE;
TRUNCATE TABLE projects CASCADE;
TRUNCATE TABLE users CASCADE;
TRUNCATE TABLE generations CASCADE;

-- Reset sequences (note: generations table uses UUID, no sequence needed)
ALTER SEQUENCE IF EXISTS projects_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS users_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS project_files_id_seq RESTART WITH 1;

-- Re-enable foreign key checks
SET session_replication_role = 'origin';

-- Verify tables are empty
SELECT
  'users' as table_name, COUNT(*) as count FROM users
UNION ALL
SELECT 'projects', COUNT(*) FROM projects
UNION ALL
SELECT 'project_files', COUNT(*) FROM project_files
UNION ALL
SELECT 'generations', COUNT(*) FROM generations;
