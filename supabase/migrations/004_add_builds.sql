-- Builds/versioning support
-- Creates builds table and build_id on project_files for per-build file snapshots

create table if not exists public.builds (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  version integer not null,
  status text not null default 'pending', -- pending | success | failed
  storage_path text null,
  build_hash text null,
  git_repo_url text null,
  git_commit_sha text null,
  git_tag text null,
  created_at timestamptz not null default now()
);

-- Ensure one version per project
create unique index if not exists builds_project_version_idx
  on public.builds(project_id, version);

-- Optional: quick lookup by project
create index if not exists builds_project_idx on public.builds(project_id);

-- Add build_id to project_files for scoping files to builds
alter table public.project_files
  add column if not exists build_id uuid null references public.builds(id) on delete cascade;

-- Helpful index for latest-per-path queries
create index if not exists project_files_project_path_created_idx
  on public.project_files(project_id, file_path, created_at desc);

-- RLS (assumes projects/users already protected); mirror project_files policies if needed
-- (Left to existing RLS configuration in your project)


