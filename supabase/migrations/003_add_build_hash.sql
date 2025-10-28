-- Add build_hash column to projects table
ALTER TABLE projects ADD COLUMN build_hash TEXT;

-- Add comment explaining the column
COMMENT ON COLUMN projects.build_hash IS 'SHA-256 hash of the current build for change detection';
