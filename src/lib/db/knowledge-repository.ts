import "server-only";

import type { Pool, PoolClient } from "pg";

import { getDbPool } from "@/lib/db/client";
import { DATABASE_NOT_CONFIGURED_MESSAGE } from "@/lib/db/env";
import {
  ensureDatabaseSchema,
  KNOWLEDGE_CHUNKS_TABLE,
  KNOWLEDGE_DOCUMENTS_TABLE,
} from "@/lib/db/schema";
import type { KnowledgeChunkSearchResult } from "@/lib/agent/types";
import type {
  KnowledgeChunkInput,
  KnowledgeChunkRecord,
  KnowledgeDocumentRecord,
  KnowledgeDocumentStatus,
} from "@/lib/knowledge/types";

export interface CreateKnowledgeDocumentInput {
  userId: string;
  title: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  extractedText?: string;
  status?: KnowledgeDocumentStatus;
  errorMessage?: string | null;
}

export interface UpdateKnowledgeDocumentStatusInput {
  documentId: string;
  userId: string;
  status: KnowledgeDocumentStatus;
  extractedText?: string;
  errorMessage?: string | null;
  chunkCount?: number;
}

export interface KnowledgeDocumentLookupInput {
  documentId: string;
  userId: string;
}

export interface ListKnowledgeDocumentsByUserInput {
  userId: string;
  limit?: number;
}

export interface BulkInsertKnowledgeChunksInput extends KnowledgeDocumentLookupInput {
  chunks: KnowledgeChunkInput[];
}

export interface SearchKnowledgeChunksByUserInput {
  userId: string;
  query: string;
  topK?: number;
  minScore?: number;
  mode?: "fts" | "keyword" | "hybrid" | "vector";
}

export interface GetKnowledgeChunksByIdsInput {
  userId: string;
  chunkIds: string[];
}

export interface GetKnowledgeDocumentMetaByIdsInput {
  userId: string;
  documentIds: string[];
}

export interface KnowledgeDocumentMeta {
  documentId: string;
  title: string;
  status: KnowledgeDocumentStatus;
  updatedAt: string;
}

interface KnowledgeDocumentRow {
  id: string;
  user_id: string;
  title: string;
  original_filename: string;
  mime_type: string;
  file_size: number | string;
  extracted_text: string;
  status: KnowledgeDocumentStatus;
  error_message: string | null;
  chunk_count: number;
  created_at: Date;
  updated_at: Date;
}

interface KnowledgeChunkRow {
  id: string;
  document_id: string;
  user_id: string;
  chunk_index: number;
  content: string;
  char_count: number;
  embedding_status: "pending" | "ready" | "failed";
  metadata: Record<string, unknown>;
  created_at: Date;
}

interface KnowledgeChunkSearchRow {
  chunk_id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  document_title: string;
  fts_score: number | string | null;
}

interface Queryable {
  query: <TRow = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: TRow[] }>;
}

const getRequiredPool = async () => {
  const pool = getDbPool();
  if (!pool) {
    throw new Error(DATABASE_NOT_CONFIGURED_MESSAGE);
  }

  await ensureDatabaseSchema();
  return pool;
};

const mapDocumentRow = (row: KnowledgeDocumentRow): KnowledgeDocumentRecord => ({
  id: row.id,
  userId: row.user_id,
  title: row.title,
  originalFilename: row.original_filename,
  mimeType: row.mime_type,
  fileSize: Number(row.file_size),
  extractedText: row.extracted_text,
  status: row.status,
  errorMessage: row.error_message,
  chunkCount: Number(row.chunk_count),
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const mapChunkRow = (row: KnowledgeChunkRow): KnowledgeChunkRecord => ({
  id: row.id,
  documentId: row.document_id,
  userId: row.user_id,
  chunkIndex: row.chunk_index,
  content: row.content,
  charCount: row.char_count,
  embeddingStatus: row.embedding_status,
  metadata: row.metadata ?? {},
  createdAt: row.created_at.toISOString(),
});

const normalizeWhitespace = (value: string) =>
  value.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();

const normalizeForMatch = (value: string) => normalizeWhitespace(value).toLowerCase();

const escapeLikePattern = (value: string) => value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

const unique = <T>(values: T[]) => Array.from(new Set(values));

const QUERY_NOISE_TERMS = new Set([
  "请",
  "请问",
  "一下",
  "结合",
  "给出",
  "标准",
  "回复",
  "应该",
  "怎么",
  "如何",
  "一个",
  "场景",
  "时候",
  "时",
  "吗",
  "呢",
  "内容",
  "说明",
  "建议",
  "文档",
  "知识库",
  "资料",
  "the",
  "and",
  "for",
  "with",
  "from",
]);

const extractQueryTerms = (query: string) =>
  unique(
    normalizeForMatch(query)
      .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
      .filter(Boolean)
      .filter((term) => term.length > 1)
      .filter((term) => !QUERY_NOISE_TERMS.has(term)),
  ).slice(0, 8);

const createSnippet = (content: string, queryTerms: string[]) => {
  const normalizedContent = normalizeWhitespace(content);
  if (!normalizedContent) {
    return "";
  }

  const matchedTerm = queryTerms.find((term) =>
    normalizeForMatch(normalizedContent).includes(term),
  );

  if (!matchedTerm) {
    return normalizedContent.slice(0, 180);
  }

  const lowerContent = normalizeForMatch(normalizedContent);
  const startIndex = Math.max(0, lowerContent.indexOf(matchedTerm) - 48);
  const endIndex = Math.min(normalizedContent.length, startIndex + 180);
  const snippet = normalizedContent.slice(startIndex, endIndex);
  return startIndex > 0 ? `...${snippet}` : snippet;
};

const scoreKnowledgeChunk = ({
  query,
  queryTerms,
  documentTitle,
  content,
  ftsScore,
}: {
  query: string;
  queryTerms: string[];
  documentTitle: string;
  content: string;
  ftsScore: number;
}) => {
  const normalizedQuery = normalizeForMatch(query);
  const normalizedTitle = normalizeForMatch(documentTitle);
  const normalizedContent = normalizeForMatch(content);
  const exactQueryHit =
    normalizedQuery.length > 1 &&
    (normalizedTitle.includes(normalizedQuery) || normalizedContent.includes(normalizedQuery))
      ? 1
      : 0;
  const titleHits = queryTerms.filter((term) => normalizedTitle.includes(term)).length;
  const contentHits = queryTerms.filter((term) => normalizedContent.includes(term)).length;

  return Number(
    (
      Math.min(ftsScore, 1.5) * 0.55 +
      exactQueryHit * 0.24 +
      Math.min(titleHits, 4) * 0.13 +
      Math.min(contentHits, 6) * 0.06
    ).toFixed(4),
  );
};

const assertDocumentOwnership = async (
  db: Queryable,
  { documentId, userId }: KnowledgeDocumentLookupInput,
) => {
  const result = await db.query<{ id: string }>(
    `
      SELECT id
      FROM ${KNOWLEDGE_DOCUMENTS_TABLE}
      WHERE id = $1 AND user_id = $2
      LIMIT 1
    `,
    [documentId, userId],
  );

  if (!result.rows[0]) {
    throw new Error("Knowledge document not found.");
  }
};

const buildInsertChunkStatement = ({
  documentId,
  userId,
  chunks,
}: BulkInsertKnowledgeChunksInput) => {
  const values: unknown[] = [];
  const placeholders = chunks.map((chunk, index) => {
    const offset = index * 7;
    values.push(
      chunk.id ?? crypto.randomUUID(),
      documentId,
      userId,
      chunk.chunkIndex,
      chunk.content,
      chunk.charCount,
      JSON.stringify(chunk.metadata ?? {}),
    );

    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, 'pending', $${offset + 7}::jsonb)`;
  });

  return {
    text: `
      INSERT INTO ${KNOWLEDGE_CHUNKS_TABLE} (
        id,
        document_id,
        user_id,
        chunk_index,
        content,
        char_count,
        embedding_status,
        metadata
      )
      VALUES ${placeholders.join(", ")}
      RETURNING *
    `,
    values,
  };
};

const bulkInsertKnowledgeChunksWithDb = async (
  db: Queryable,
  input: BulkInsertKnowledgeChunksInput,
) => {
  if (input.chunks.length === 0) {
    return [] satisfies KnowledgeChunkRecord[];
  }

  await assertDocumentOwnership(db, input);
  const statement = buildInsertChunkStatement(input);
  const result = await db.query<KnowledgeChunkRow>(statement.text, statement.values);
  return result.rows.map(mapChunkRow);
};

const withTransaction = async <T>(pool: Pool, callback: (client: PoolClient) => Promise<T>) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const createKnowledgeDocument = async ({
  userId,
  title,
  originalFilename,
  mimeType,
  fileSize,
  extractedText = "",
  status = "uploaded",
  errorMessage = null,
}: CreateKnowledgeDocumentInput) => {
  const pool = await getRequiredPool();
  const result = await pool.query<KnowledgeDocumentRow>(
    `
      INSERT INTO ${KNOWLEDGE_DOCUMENTS_TABLE} (
        id,
        user_id,
        title,
        original_filename,
        mime_type,
        file_size,
        extracted_text,
        status,
        error_message
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
    [
      crypto.randomUUID(),
      userId,
      title,
      originalFilename,
      mimeType,
      fileSize,
      extractedText,
      status,
      errorMessage,
    ],
  );

  return mapDocumentRow(result.rows[0]);
};

export const updateKnowledgeDocumentStatus = async ({
  documentId,
  userId,
  status,
  extractedText,
  errorMessage,
  chunkCount,
}: UpdateKnowledgeDocumentStatusInput) => {
  const pool = await getRequiredPool();
  const values: unknown[] = [documentId, userId, status];
  const sets = ["status = $3", "updated_at = NOW()"];

  if (extractedText !== undefined) {
    values.push(extractedText);
    sets.push(`extracted_text = $${values.length}`);
  }

  if (errorMessage !== undefined) {
    values.push(errorMessage);
    sets.push(`error_message = $${values.length}`);
  }

  if (chunkCount !== undefined) {
    values.push(chunkCount);
    sets.push(`chunk_count = $${values.length}`);
  }

  const result = await pool.query<KnowledgeDocumentRow>(
    `
      UPDATE ${KNOWLEDGE_DOCUMENTS_TABLE}
      SET ${sets.join(", ")}
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `,
    values,
  );

  return result.rows[0] ? mapDocumentRow(result.rows[0]) : null;
};

export const getKnowledgeDocumentById = async ({
  documentId,
  userId,
}: KnowledgeDocumentLookupInput) => {
  const pool = await getRequiredPool();
  const result = await pool.query<KnowledgeDocumentRow>(
    `
      SELECT *
      FROM ${KNOWLEDGE_DOCUMENTS_TABLE}
      WHERE id = $1 AND user_id = $2
      LIMIT 1
    `,
    [documentId, userId],
  );

  return result.rows[0] ? mapDocumentRow(result.rows[0]) : null;
};

export const listKnowledgeDocumentsByUser = async ({
  userId,
  limit = 50,
}: ListKnowledgeDocumentsByUserInput) => {
  const pool = await getRequiredPool();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const result = await pool.query<KnowledgeDocumentRow>(
    `
      SELECT *
      FROM ${KNOWLEDGE_DOCUMENTS_TABLE}
      WHERE user_id = $1
      ORDER BY updated_at DESC
      LIMIT $2
    `,
    [userId, safeLimit],
  );

  return result.rows.map(mapDocumentRow);
};

export const deleteKnowledgeDocument = async ({
  documentId,
  userId,
}: KnowledgeDocumentLookupInput) => {
  const pool = await getRequiredPool();
  const result = await pool.query<{ id: string }>(
    `
      DELETE FROM ${KNOWLEDGE_DOCUMENTS_TABLE}
      WHERE id = $1 AND user_id = $2
      RETURNING id
    `,
    [documentId, userId],
  );

  return Boolean(result.rows[0]);
};

export const bulkInsertKnowledgeChunks = async (input: BulkInsertKnowledgeChunksInput) => {
  const pool = await getRequiredPool();
  return bulkInsertKnowledgeChunksWithDb(pool, input);
};

export const listKnowledgeChunksByDocument = async ({
  documentId,
  userId,
}: KnowledgeDocumentLookupInput) => {
  const pool = await getRequiredPool();
  const result = await pool.query<KnowledgeChunkRow>(
    `
      SELECT *
      FROM ${KNOWLEDGE_CHUNKS_TABLE}
      WHERE document_id = $1 AND user_id = $2
      ORDER BY chunk_index ASC
    `,
    [documentId, userId],
  );

  return result.rows.map(mapChunkRow);
};

export const getKnowledgeChunksByIds = async ({
  userId,
  chunkIds,
}: GetKnowledgeChunksByIdsInput) => {
  if (chunkIds.length === 0) {
    return [] satisfies KnowledgeChunkRecord[];
  }

  const pool = await getRequiredPool();
  const result = await pool.query<KnowledgeChunkRow>(
    `
      SELECT *
      FROM ${KNOWLEDGE_CHUNKS_TABLE}
      WHERE user_id = $1
        AND id = ANY($2::text[])
      ORDER BY chunk_index ASC
    `,
    [userId, chunkIds],
  );

  return result.rows.map(mapChunkRow);
};

export const getKnowledgeDocumentMetaByIds = async ({
  userId,
  documentIds,
}: GetKnowledgeDocumentMetaByIdsInput) => {
  if (documentIds.length === 0) {
    return [] satisfies KnowledgeDocumentMeta[];
  }

  const pool = await getRequiredPool();
  const result = await pool.query<{
    id: string;
    title: string;
    status: KnowledgeDocumentStatus;
    updated_at: Date;
  }>(
    `
      SELECT
        id,
        title,
        status,
        updated_at
      FROM ${KNOWLEDGE_DOCUMENTS_TABLE}
      WHERE user_id = $1
        AND id = ANY($2::text[])
      ORDER BY updated_at DESC
    `,
    [userId, documentIds],
  );

  return result.rows.map((row) => ({
    documentId: row.id,
    title: row.title,
    status: row.status,
    updatedAt: row.updated_at.toISOString(),
  }));
};

export const searchKnowledgeChunksByUser = async ({
  userId,
  query,
  topK = 4,
  minScore = 0,
  mode = "fts",
}: SearchKnowledgeChunksByUserInput) => {
  const pool = await getRequiredPool();
  const normalizedQuery = normalizeWhitespace(query);
  if (!normalizedQuery) {
    return [] satisfies KnowledgeChunkSearchResult[];
  }

  const queryTerms = extractQueryTerms(normalizedQuery);
  const likePatterns = unique(
    [normalizedQuery, ...queryTerms]
      .map((term) => normalizeForMatch(term))
      .filter((term) => term.length > 1)
      .map((term) => `%${escapeLikePattern(term)}%`),
  );
  const safeTopK = Math.min(Math.max(Math.trunc(topK), 1), 20);
  const candidateLimit = Math.max(safeTopK * 6, 12);
  const allowFts = mode === "fts" || mode === "hybrid" || mode === "vector";
  const allowKeyword = mode === "keyword" || mode === "hybrid" || mode === "vector" || likePatterns.length > 0;
  const result = await pool.query<KnowledgeChunkSearchRow>(
    `
      WITH ranked_chunks AS (
        SELECT
          chunk.id AS chunk_id,
          chunk.document_id,
          chunk.chunk_index,
          chunk.content,
          document.title AS document_title,
          CASE
            WHEN $5::boolean
              THEN ts_rank_cd(
                to_tsvector('simple', COALESCE(document.title, '') || ' ' || chunk.content),
                plainto_tsquery('simple', $2)
              )
            ELSE 0
          END AS fts_score
        FROM ${KNOWLEDGE_CHUNKS_TABLE} AS chunk
        INNER JOIN ${KNOWLEDGE_DOCUMENTS_TABLE} AS document
          ON document.id = chunk.document_id
        WHERE chunk.user_id = $1
          AND document.user_id = $1
          AND document.status = 'chunked'
          AND (
            ($5::boolean AND to_tsvector('simple', COALESCE(document.title, '') || ' ' || chunk.content) @@ plainto_tsquery('simple', $2))
            OR ($6::boolean AND (
              lower(document.title) LIKE ANY($3::text[])
              OR lower(chunk.content) LIKE ANY($3::text[])
            ))
          )
      )
      SELECT *
      FROM ranked_chunks
      ORDER BY fts_score DESC, chunk_index ASC
      LIMIT $4
    `,
    [userId, normalizedQuery, likePatterns, candidateLimit, allowFts, allowKeyword],
  );

  return result.rows
    .filter((row) => row.document_title && row.content)
    .map((row) => {
      const baseScore = scoreKnowledgeChunk({
        query: normalizedQuery,
        queryTerms,
        documentTitle: row.document_title,
        content: row.content,
        ftsScore: Number(row.fts_score ?? 0),
      });

      return {
        documentId: row.document_id,
        documentTitle: row.document_title,
        chunkId: row.chunk_id,
        chunkIndex: row.chunk_index,
        content: row.content,
        score: baseScore,
        sourceType: "knowledge_base" as const,
        snippet: createSnippet(row.content, [normalizeForMatch(normalizedQuery), ...queryTerms]),
      } satisfies KnowledgeChunkSearchResult;
    })
    .filter((result) => result.score >= minScore)
    .sort((left, right) => right.score - left.score || left.chunkIndex - right.chunkIndex)
    .slice(0, safeTopK);
};

export const persistKnowledgeDocumentChunks = async ({
  documentId,
  userId,
  chunks,
}: BulkInsertKnowledgeChunksInput) => {
  if (chunks.length === 0) {
    throw new Error("Knowledge document did not produce any chunks.");
  }

  const pool = await getRequiredPool();

  return withTransaction(pool, async (client) => {
    const insertedChunks = await bulkInsertKnowledgeChunksWithDb(client, {
      documentId,
      userId,
      chunks,
    });

    const result = await client.query<KnowledgeDocumentRow>(
      `
        UPDATE ${KNOWLEDGE_DOCUMENTS_TABLE}
        SET
          status = 'chunked',
          chunk_count = $3,
          error_message = NULL,
          updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING *
      `,
      [documentId, userId, insertedChunks.length],
    );

    if (!result.rows[0]) {
      throw new Error("Knowledge document not found.");
    }

    return {
      document: mapDocumentRow(result.rows[0]),
      chunks: insertedChunks,
    };
  });
};
