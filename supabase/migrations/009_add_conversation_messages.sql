-- Conversation history for chat-based system
-- Stores all messages, tool calls, and responses for context across sessions

CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content TEXT,
  tool_name TEXT, -- For tool messages: 'lov-view', 'lov-write', etc.
  tool_call_id TEXT, -- For tool messages: links to assistant's tool_call_id
  metadata JSONB DEFAULT '{}'::jsonb, -- Additional data (file paths, tool params, etc.)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast retrieval of conversation history
CREATE INDEX IF NOT EXISTS idx_conversation_project ON public.conversation_messages(project_id, created_at DESC);

-- Index for tool call linking
CREATE INDEX IF NOT EXISTS idx_conversation_tool_call ON public.conversation_messages(tool_call_id) WHERE tool_call_id IS NOT NULL;

-- RLS: Users can only see messages for their own projects
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own conversation messages"
  ON public.conversation_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = conversation_messages.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own conversation messages"
  ON public.conversation_messages
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = conversation_messages.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- Stores all messages, tool calls, and responses for context across sessions

CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content TEXT,
  tool_name TEXT, -- For tool messages: 'lov-view', 'lov-write', etc.
  tool_call_id TEXT, -- For tool messages: links to assistant's tool_call_id
  metadata JSONB DEFAULT '{}'::jsonb, -- Additional data (file paths, tool params, etc.)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast retrieval of conversation history
CREATE INDEX IF NOT EXISTS idx_conversation_project ON public.conversation_messages(project_id, created_at DESC);

-- Index for tool call linking
CREATE INDEX IF NOT EXISTS idx_conversation_tool_call ON public.conversation_messages(tool_call_id) WHERE tool_call_id IS NOT NULL;

-- RLS: Users can only see messages for their own projects
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own conversation messages"
  ON public.conversation_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = conversation_messages.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own conversation messages"
  ON public.conversation_messages
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = conversation_messages.project_id
      AND projects.user_id = auth.uid()
    )
  );

