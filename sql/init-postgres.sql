CREATE TABLE IF NOT EXISTS agent_run_logs (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
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
