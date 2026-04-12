import "server-only";

import type { ChatMessage } from "@/lib/agent/types";
import { getDbPool } from "@/lib/db/client";
import { DATABASE_NOT_CONFIGURED_MESSAGE } from "@/lib/db/env";
import {
  CHAT_MESSAGES_TABLE,
  CHAT_SESSIONS_TABLE,
  ensureDatabaseSchema,
} from "@/lib/db/schema";

export interface ChatSessionRecord {
  id: string;
  userId: string;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
}

export interface ChatMessageRecord {
  id: string;
  sessionId: string;
  role: ChatMessage["role"];
  content: string;
  metadata: Record<string, unknown>;
  sequenceNo: number;
  createdAt: string;
}

export interface CreateSessionInput {
  userId: string;
  sessionId?: string;
  title?: string;
}

export interface ListSessionsByUserInput {
  userId: string;
  limit?: number;
}

export interface SessionLookupInput {
  sessionId: string;
  userId: string;
}

export interface AppendMessageInput extends SessionLookupInput {
  messageId?: string;
  role: ChatMessage["role"];
  content: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateSessionTitleInput extends SessionLookupInput {
  title: string;
}

export interface UpdateSessionSummaryInput extends SessionLookupInput {
  summary: string;
}

interface ChatSessionRow {
  id: string;
  user_id: string;
  title: string;
  summary: string;
  created_at: Date;
  updated_at: Date;
  last_message_at: Date | null;
}

interface ChatMessageRow {
  id: string;
  session_id: string;
  role: ChatMessage["role"];
  content: string;
  metadata: Record<string, unknown>;
  sequence_no: number;
  created_at: Date;
}

const getRequiredPool = async () => {
  const pool = getDbPool();
  if (!pool) {
    throw new Error(DATABASE_NOT_CONFIGURED_MESSAGE);
  }

  await ensureDatabaseSchema();
  return pool;
};

const mapSessionRow = (row: ChatSessionRow): ChatSessionRecord => ({
  id: row.id,
  userId: row.user_id,
  title: row.title,
  summary: row.summary,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  lastMessageAt: row.last_message_at?.toISOString() ?? null,
});

const mapMessageRow = (row: ChatMessageRow): ChatMessageRecord => ({
  id: row.id,
  sessionId: row.session_id,
  role: row.role,
  content: row.content,
  metadata: row.metadata ?? {},
  sequenceNo: row.sequence_no,
  createdAt: row.created_at.toISOString(),
});

export const createSession = async ({ userId, sessionId, title }: CreateSessionInput) => {
  const pool = await getRequiredPool();
  const nextSessionId = sessionId ?? crypto.randomUUID();
  const result = await pool.query<ChatSessionRow>(
    `
      INSERT INTO ${CHAT_SESSIONS_TABLE} (
        id,
        user_id,
        title
      )
      VALUES ($1, $2, COALESCE($3, '新对话'))
      ON CONFLICT (id) DO NOTHING
      RETURNING *
    `,
    [nextSessionId, userId, title ?? null],
  );

  if (result.rows[0]) {
    return mapSessionRow(result.rows[0]);
  }

  return getSessionById({
    sessionId: nextSessionId,
    userId,
  });
};

export const listSessionsByUser = async ({
  userId,
  limit = 50,
}: ListSessionsByUserInput) => {
  const pool = await getRequiredPool();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const result = await pool.query<ChatSessionRow>(
    `
      SELECT *
      FROM ${CHAT_SESSIONS_TABLE}
      WHERE user_id = $1
      ORDER BY COALESCE(last_message_at, updated_at) DESC, updated_at DESC
      LIMIT $2
    `,
    [userId, safeLimit],
  );

  return result.rows.map(mapSessionRow);
};

export const getSessionById = async ({ sessionId, userId }: SessionLookupInput) => {
  const pool = await getRequiredPool();
  const result = await pool.query<ChatSessionRow>(
    `
      SELECT *
      FROM ${CHAT_SESSIONS_TABLE}
      WHERE id = $1 AND user_id = $2
      LIMIT 1
    `,
    [sessionId, userId],
  );

  return result.rows[0] ? mapSessionRow(result.rows[0]) : null;
};

export const appendMessage = async ({
  sessionId,
  userId,
  messageId,
  role,
  content,
  metadata,
}: AppendMessageInput) => {
  const pool = await getRequiredPool();
  const result = await pool.query<ChatMessageRow>(
    `
      WITH updated_session AS (
        UPDATE ${CHAT_SESSIONS_TABLE}
        SET
          next_message_sequence = next_message_sequence + 1,
          updated_at = NOW(),
          last_message_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING id, next_message_sequence - 1 AS sequence_no
      )
      INSERT INTO ${CHAT_MESSAGES_TABLE} (
        id,
        session_id,
        role,
        content,
        metadata,
        sequence_no
      )
      SELECT
        $3,
        updated_session.id,
        $4,
        $5,
        $6::jsonb,
        updated_session.sequence_no
      FROM updated_session
      RETURNING *
    `,
    [
      sessionId,
      userId,
      messageId ?? crypto.randomUUID(),
      role,
      content,
      JSON.stringify(metadata ?? {}),
    ],
  );

  return result.rows[0] ? mapMessageRow(result.rows[0]) : null;
};

export const listMessagesBySession = async ({ sessionId, userId }: SessionLookupInput) => {
  const pool = await getRequiredPool();
  const result = await pool.query<ChatMessageRow>(
    `
      SELECT message.*
      FROM ${CHAT_MESSAGES_TABLE} AS message
      INNER JOIN ${CHAT_SESSIONS_TABLE} AS session
        ON session.id = message.session_id
      WHERE session.id = $1 AND session.user_id = $2
      ORDER BY message.sequence_no ASC
    `,
    [sessionId, userId],
  );

  return result.rows.map(mapMessageRow);
};

export const updateSessionTitle = async ({
  sessionId,
  userId,
  title,
}: UpdateSessionTitleInput) => {
  const pool = await getRequiredPool();
  const result = await pool.query<ChatSessionRow>(
    `
      UPDATE ${CHAT_SESSIONS_TABLE}
      SET
        title = $3,
        updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `,
    [sessionId, userId, title],
  );

  return result.rows[0] ? mapSessionRow(result.rows[0]) : null;
};

export const updateSessionSummary = async ({
  sessionId,
  userId,
  summary,
}: UpdateSessionSummaryInput) => {
  const pool = await getRequiredPool();
  const result = await pool.query<ChatSessionRow>(
    `
      UPDATE ${CHAT_SESSIONS_TABLE}
      SET
        summary = $3,
        updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `,
    [sessionId, userId, summary],
  );

  return result.rows[0] ? mapSessionRow(result.rows[0]) : null;
};

export const touchSessionLastMessageAt = async ({ sessionId }: { sessionId: string }) => {
  const pool = await getRequiredPool();
  const result = await pool.query(
    `
      UPDATE ${CHAT_SESSIONS_TABLE}
      SET
        updated_at = NOW(),
        last_message_at = NOW()
      WHERE id = $1
      RETURNING id
    `,
    [sessionId],
  );

  return Boolean(result.rows[0]);
};
