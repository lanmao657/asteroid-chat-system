import type { AgentRunTaskCategory, ToolResult } from "@/lib/agent/types";
import { getDbPool } from "@/lib/db/client";
import { AGENT_RUN_LOGS_TABLE, ensureDatabaseSchema } from "@/lib/db/schema";

export type PersistedAgentRunStatus = "completed" | "aborted" | "errored";

export interface PersistAgentRunLogInput {
  runId: string;
  sessionId: string;
  taskCategory: AgentRunTaskCategory;
  provider: string;
  status: PersistedAgentRunStatus;
  userMessage: string;
  assistantMessage: string;
  memorySummary: string;
  toolResults: ToolResult[];
  errorMessage?: string;
  startedAt: string;
  finishedAt: string;
}

export interface AgentRunLogRecord {
  id: number;
  runId: string;
  sessionId: string;
  taskCategory: AgentRunTaskCategory;
  provider: string;
  status: PersistedAgentRunStatus;
  userMessage: string;
  assistantMessage: string;
  memorySummary: string;
  toolResults: ToolResult[];
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string;
  createdAt: string;
}

interface AgentRunLogRow {
  id: number;
  run_id: string;
  session_id: string;
  task_category: AgentRunTaskCategory;
  provider: string;
  status: PersistedAgentRunStatus;
  user_message: string;
  assistant_message: string;
  memory_summary: string;
  tool_results: ToolResult[];
  error_message: string | null;
  started_at: Date;
  finished_at: Date;
  created_at: Date;
}

const mapRow = (row: AgentRunLogRow): AgentRunLogRecord => ({
  id: row.id,
  runId: row.run_id,
  sessionId: row.session_id,
  taskCategory: row.task_category,
  provider: row.provider,
  status: row.status,
  userMessage: row.user_message,
  assistantMessage: row.assistant_message,
  memorySummary: row.memory_summary,
  toolResults: row.tool_results,
  errorMessage: row.error_message,
  startedAt: row.started_at.toISOString(),
  finishedAt: row.finished_at.toISOString(),
  createdAt: row.created_at.toISOString(),
});

export const insertAgentRunLog = async (input: PersistAgentRunLogInput) => {
  const pool = getDbPool();
  if (!pool) {
    return false;
  }

  await ensureDatabaseSchema();

  await pool.query(
    `
      INSERT INTO ${AGENT_RUN_LOGS_TABLE} (
        run_id,
        session_id,
        task_category,
        provider,
        status,
        user_message,
        assistant_message,
        memory_summary,
        tool_results,
        error_message,
        started_at,
        finished_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
      ON CONFLICT (run_id)
      DO UPDATE SET
        session_id = EXCLUDED.session_id,
        task_category = EXCLUDED.task_category,
        provider = EXCLUDED.provider,
        status = EXCLUDED.status,
        user_message = EXCLUDED.user_message,
        assistant_message = EXCLUDED.assistant_message,
        memory_summary = EXCLUDED.memory_summary,
        tool_results = EXCLUDED.tool_results,
        error_message = EXCLUDED.error_message,
        started_at = EXCLUDED.started_at,
        finished_at = EXCLUDED.finished_at
    `,
    [
      input.runId,
      input.sessionId,
      input.taskCategory,
      input.provider,
      input.status,
      input.userMessage,
      input.assistantMessage,
      input.memorySummary,
      JSON.stringify(input.toolResults),
      input.errorMessage ?? null,
      input.startedAt,
      input.finishedAt,
    ],
  );

  return true;
};

export const listAgentRunLogs = async ({
  sessionId,
  limit = 20,
}: {
  sessionId?: string;
  limit?: number;
}) => {
  const pool = getDbPool();
  if (!pool) {
    return [];
  }

  await ensureDatabaseSchema();

  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const values = sessionId ? [sessionId, safeLimit] : [safeLimit];
  const query = sessionId
    ? `
        SELECT *
        FROM ${AGENT_RUN_LOGS_TABLE}
        WHERE session_id = $1
        ORDER BY finished_at DESC
        LIMIT $2
      `
    : `
        SELECT *
        FROM ${AGENT_RUN_LOGS_TABLE}
        ORDER BY finished_at DESC
        LIMIT $1
      `;

  const result = await pool.query<AgentRunLogRow>(query, values);
  return result.rows.map(mapRow);
};
