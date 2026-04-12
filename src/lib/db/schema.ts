import { getDbPool } from "@/lib/db/client";

export const AGENT_RUN_LOGS_TABLE = "agent_run_logs";
export const CHAT_SESSIONS_TABLE = "chat_sessions";
export const CHAT_MESSAGES_TABLE = "chat_messages";

export const AGENT_RUN_LOGS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ${AGENT_RUN_LOGS_TABLE} (
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

ALTER TABLE ${AGENT_RUN_LOGS_TABLE}
  ADD COLUMN IF NOT EXISTS task_category TEXT NOT NULL DEFAULT 'general';

CREATE INDEX IF NOT EXISTS agent_run_logs_session_id_finished_at_idx
  ON ${AGENT_RUN_LOGS_TABLE} (session_id, finished_at DESC);

CREATE INDEX IF NOT EXISTS agent_run_logs_task_category_finished_at_idx
  ON ${AGENT_RUN_LOGS_TABLE} (task_category, finished_at DESC);
`;

export const CHAT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ${CHAT_SESSIONS_TABLE} (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '新对话',
  summary TEXT NOT NULL DEFAULT '',
  next_message_sequence BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ${CHAT_MESSAGES_TABLE} (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES ${CHAT_SESSIONS_TABLE}(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  sequence_no BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, sequence_no)
);

CREATE INDEX IF NOT EXISTS chat_sessions_user_id_last_message_at_updated_at_idx
  ON ${CHAT_SESSIONS_TABLE} (user_id, last_message_at DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS chat_messages_session_id_sequence_no_idx
  ON ${CHAT_MESSAGES_TABLE} (session_id, sequence_no ASC);
`;

let schemaReadyPromise: Promise<void> | null = null;

export const ensureDatabaseSchema = async () => {
  const pool = getDbPool();
  if (!pool) {
    return false;
  }

  if (!schemaReadyPromise) {
    schemaReadyPromise = pool
      .query(`${AGENT_RUN_LOGS_SCHEMA_SQL}\n${CHAT_SCHEMA_SQL}`)
      .then(() => undefined)
      .catch((error) => {
        schemaReadyPromise = null;
        throw error;
      });
  }

  await schemaReadyPromise;
  return true;
};
