CREATE TABLE IF NOT EXISTS agent_run_logs (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  task_category TEXT NOT NULL DEFAULT 'general',
  provider TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('completed', 'aborted', 'errored')),
  user_message TEXT NOT NULL,
  assistant_message TEXT NOT NULL DEFAULT '',
  memory_summary TEXT NOT NULL DEFAULT '',
  tool_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_run_logs_session_id_finished_at_idx
  ON agent_run_logs (session_id, finished_at DESC);

CREATE INDEX IF NOT EXISTS agent_run_logs_task_category_finished_at_idx
  ON agent_run_logs (task_category, finished_at DESC);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '新对话',
  summary TEXT NOT NULL DEFAULT '',
  next_message_sequence BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  sequence_no BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, sequence_no)
);

CREATE INDEX IF NOT EXISTS chat_sessions_user_id_last_message_at_updated_at_idx
  ON chat_sessions (user_id, last_message_at DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS chat_messages_session_id_sequence_no_idx
  ON chat_messages (session_id, sequence_no ASC);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  extracted_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('uploaded', 'parsed', 'chunked', 'failed')) DEFAULT 'uploaded',
  error_message TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  embedding_status TEXT NOT NULL CHECK (embedding_status IN ('pending', 'ready', 'failed')) DEFAULT 'pending',
  embedding_vector JSONB,
  embedding_provider TEXT,
  embedding_model TEXT,
  embedding_dimensions INTEGER,
  embedding_error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, chunk_index)
);

ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS embedding_vector JSONB;

ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS embedding_provider TEXT;

ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS embedding_model TEXT;

ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS embedding_dimensions INTEGER;

ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS embedding_error_message TEXT;

CREATE INDEX IF NOT EXISTS knowledge_documents_user_id_updated_at_idx
  ON knowledge_documents (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS knowledge_documents_user_id_status_updated_at_idx
  ON knowledge_documents (user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS knowledge_chunks_document_id_chunk_index_idx
  ON knowledge_chunks (document_id, chunk_index ASC);

CREATE INDEX IF NOT EXISTS knowledge_chunks_user_id_document_id_idx
  ON knowledge_chunks (user_id, document_id);

CREATE INDEX IF NOT EXISTS knowledge_chunks_user_id_embedding_status_created_at_idx
  ON knowledge_chunks (user_id, embedding_status, created_at ASC);

CREATE INDEX IF NOT EXISTS knowledge_documents_title_idx
  ON knowledge_documents (title);

CREATE INDEX IF NOT EXISTS knowledge_chunks_content_fts_idx
  ON knowledge_chunks
  USING GIN (to_tsvector('simple', content));
