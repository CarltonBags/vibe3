-- Track amendment history per project/build

create table if not exists public.amendments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  build_id uuid null references public.builds(id) on delete set null,
  prompt text not null,
  summary text null,
  file_paths jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists amendments_project_idx on public.amendments(project_id, created_at desc);


