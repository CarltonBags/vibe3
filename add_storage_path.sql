-- Add missing storage_path column to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS storage_path TEXT;

-- Verify the column was added
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'projects' AND column_name = 'storage_path';
