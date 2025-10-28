# Supabase Storage Setup

## 1. Create Storage Bucket

Create a new bucket in Supabase dashboard:
- Name: `project-builds`
- Public: No (private access)
- File size limit: 50 MB
- Allowed MIME types: All

## 2. Set up RLS Policies

Run these SQL queries in the Supabase SQL editor:

```sql
-- Allow users to upload their own project builds
CREATE POLICY "Users can upload their own project builds"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'project-builds' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow users to read their own project builds
CREATE POLICY "Users can read their own project builds"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'project-builds' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow users to update their own project builds
CREATE POLICY "Users can update their own project builds"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'project-builds' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow users to delete their own project builds
CREATE POLICY "Users can delete their own project builds"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'project-builds' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
```

## 3. Update database tables

### Update projects table

Add these columns if they don't exist:

```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS build_hash TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS build_version INTEGER DEFAULT 1;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS storage_path TEXT;
```

### Update project_files table

Add version tracking if it doesn't exist:

```sql
ALTER TABLE project_files ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
```

This allows you to:
- Query files for a specific build version
- Roll back to previous versions by selecting files with a specific version
- Track which files belong to which build

## 4. Environment Variables

Make sure these are set in `.env.local`:

```
SUPABASE_PROJECT_ID=your-project-id
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```
