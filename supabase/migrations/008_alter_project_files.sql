-- Add build_version to projects and allow multiple versions of the same file path

alter table public.projects
  add column if not exists build_version integer;

-- Drop unique constraint on (project_id, file_path) to enable append-only versions
do $$
begin
  if exists (
    select 1 from pg_indexes 
    where schemaname = 'public' 
      and indexname = 'project_files_project_id_file_path_key'
  ) then
    -- some deployments create a named constraint, handle both index and constraint paths
    begin
      alter table public.project_files drop constraint project_files_project_id_file_path_key;
    exception when others then
      -- if it's an index instead of a constraint, try drop index
      begin
        drop index if exists public.project_files_project_id_file_path_key;
      exception when others then null; end;
    end;
  end if;
end$$;

-- Optional: add a helper index for frequent queries by project and path
create index if not exists project_files_project_path_idx
  on public.project_files(project_id, file_path);


