import { supabaseAdmin } from './supabase'

/**
 * Database migrations for project builds
 */
export async function runMigrations() {
  console.log('Running database migrations...')

  try {
    // Add build-related columns to projects table if they don't exist
    const { error } = await supabaseAdmin.rpc('exec_sql', {
      sql: `
        DO $$ 
        BEGIN
          -- Add build_hash column
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'projects' AND column_name = 'build_hash'
          ) THEN
            ALTER TABLE projects ADD COLUMN build_hash TEXT;
          END IF;

          -- Add build_version column
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'projects' AND column_name = 'build_version'
          ) THEN
            ALTER TABLE projects ADD COLUMN build_version INTEGER DEFAULT 1;
          END IF;

          -- Add storage_path column
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'projects' AND column_name = 'storage_path'
          ) THEN
            ALTER TABLE projects ADD COLUMN storage_path TEXT;
          END IF;
        END $$;
      `
    })

    if (error) {
      console.log('Migrations already applied or schema updated:', error)
    } else {
      console.log('✅ Migrations completed successfully')
    }
  } catch (err) {
    console.error('Error running migrations:', err)
  }
}

