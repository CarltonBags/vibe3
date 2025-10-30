-- Enable pgvector and create file chunk embeddings table

create extension if not exists vector;

create table if not exists public.file_chunks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  build_id uuid null references public.builds(id) on delete cascade,
  file_path text not null,
  chunk_index integer not null,
  content text not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);

create index if not exists file_chunks_project_idx on public.file_chunks(project_id);
create index if not exists file_chunks_project_file_idx on public.file_chunks(project_id, file_path);
-- Vector index (requires pgvector)
create index if not exists file_chunks_embedding_idx on public.file_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);


