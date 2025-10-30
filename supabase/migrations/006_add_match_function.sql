-- RPC to match file chunks by vector similarity

create or replace function public.match_file_chunks(
  p_project_id uuid,
  p_query vector,
  p_match_count int default 20
)
returns table(
  id uuid,
  project_id uuid,
  build_id uuid,
  file_path text,
  chunk_index int,
  content text,
  similarity float
) language sql stable as $$
  select c.id, c.project_id, c.build_id, c.file_path, c.chunk_index, c.content,
         1 - (c.embedding <=> p_query) as similarity
  from public.file_chunks c
  where c.project_id = p_project_id
  order by c.embedding <=> p_query
  limit p_match_count
$$;


