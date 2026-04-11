import { getDbPool } from "@/lib/db/client";

export const AGENT_RUN_LOGS_TABLE = "agent_run_logs";

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

let schemaReadyPromise: Promise<void> | null = null;

export const ensureDatabaseSchema = async () => {
  const pool = getDbPool();
  if (!pool) {
    return false;
  }

  if (!schemaReadyPromise) {
    schemaReadyPromise = pool
      .query(AGENT_RUN_LOGS_SCHEMA_SQL)
      .then(() => undefined)
      .catch((error) => {
        schemaReadyPromise = null;
        throw error;
      });
  }

  await schemaReadyPromise;
  return true;
};
