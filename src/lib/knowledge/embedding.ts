import "server-only";

import { agentEnv } from "@/lib/agent/env";
import {
  listKnowledgeChunksForEmbedding,
  updateKnowledgeChunkEmbedding,
} from "@/lib/db/knowledge-repository";

import type { KnowledgeChunkRecord } from "@/lib/knowledge/types";

interface EmbeddedChunkResult {
  chunkId: string;
  status: "ready" | "failed" | "skipped";
  errorMessage?: string;
}

const DEFAULT_EMBEDDING_BATCH_SIZE = Math.min(
  Math.max(agentEnv.knowledgeBaseEmbeddingBatchSize, 1),
  32,
);

const createEmbeddingAbortSignal = (timeoutMs: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("embedding-timeout"), timeoutMs);

  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timeout),
  };
};

const getEmbeddingConfigError = () => {
  if (!agentEnv.openAiCompatApiKey) {
    return "Embedding API is not configured. Please set OPENAI_COMPAT_API_KEY.";
  }

  if (!agentEnv.knowledgeBaseEmbeddingModel) {
    return "Embedding model is not configured. Please set KNOWLEDGE_BASE_EMBEDDING_MODEL.";
  }

  return null;
};

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return "Knowledge chunk embedding failed.";
};

const requestEmbeddings = async (inputs: string[]) => {
  const { signal, dispose } = createEmbeddingAbortSignal(
    agentEnv.knowledgeBaseEmbeddingTimeoutMs,
  );

  try {
    const response = await fetch(
      `${agentEnv.openAiCompatBaseUrl.replace(/\/$/, "")}/embeddings`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${agentEnv.openAiCompatApiKey}`,
        },
        body: JSON.stringify({
          input: inputs,
          model: agentEnv.knowledgeBaseEmbeddingModel,
        }),
        signal,
      },
    );

    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.text();
      } catch {
        detail = "";
      }

      throw new Error(
        detail
          ? `Embedding request failed with status ${response.status}: ${detail}`
          : `Embedding request failed with status ${response.status}.`,
      );
    }

    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[]; index?: number }>;
    };
    const data = payload.data ?? [];

    return data
      .slice()
      .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
      .map((item) => item.embedding ?? null);
  } finally {
    dispose();
  }
};

const persistChunkEmbeddingFailure = async ({
  chunk,
  errorMessage,
}: {
  chunk: KnowledgeChunkRecord;
  errorMessage: string;
}) => {
  const result = await updateKnowledgeChunkEmbedding({
    chunkId: chunk.id,
    userId: chunk.userId,
    embeddingStatus: "failed",
    embeddingVector: null,
    embeddingProvider: null,
    embeddingModel: null,
    embeddingDimensions: null,
    embeddingErrorMessage: errorMessage,
    skipIfAlreadyReady: true,
  });

  if (result.skipped) {
    return {
      chunkId: chunk.id,
      status: "skipped" as const,
    };
  }

  return {
    chunkId: chunk.id,
    status: "failed" as const,
    errorMessage,
  };
};

const persistChunkEmbeddingReady = async ({
  chunk,
  embedding,
}: {
  chunk: KnowledgeChunkRecord;
  embedding: number[];
}) => {
  const result = await updateKnowledgeChunkEmbedding({
    chunkId: chunk.id,
    userId: chunk.userId,
    embeddingStatus: "ready",
    embeddingVector: embedding,
    embeddingProvider: "openai-compatible",
    embeddingModel: agentEnv.knowledgeBaseEmbeddingModel,
    embeddingDimensions: embedding.length,
    embeddingErrorMessage: null,
    skipIfAlreadyReady: true,
  });

  if (result.skipped) {
    return {
      chunkId: chunk.id,
      status: "skipped" as const,
    };
  }

  return {
    chunkId: chunk.id,
    status: "ready" as const,
  };
};

const embedChunk = async (chunk: KnowledgeChunkRecord) => {
  try {
    const [embedding] = await requestEmbeddings([chunk.content]);
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error("Embedding response did not include a vector.");
    }

    return await persistChunkEmbeddingReady({
      chunk,
      embedding,
    });
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    return await persistChunkEmbeddingFailure({
      chunk,
      errorMessage,
    });
  }
};

const embedChunkBatch = async (chunks: KnowledgeChunkRecord[]) => {
  try {
    const embeddings = await requestEmbeddings(chunks.map((chunk) => chunk.content));

    if (embeddings.length !== chunks.length) {
      throw new Error("Embedding response count did not match the requested chunk count.");
    }

    const results: EmbeddedChunkResult[] = [];
    for (const [index, chunk] of chunks.entries()) {
      const embedding = embeddings[index];
      if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error(`Embedding response for chunk ${chunk.id} was empty.`);
      }

      results.push(
        await persistChunkEmbeddingReady({
          chunk,
          embedding,
        }),
      );
    }

    return results;
  } catch {
    const fallbackResults: EmbeddedChunkResult[] = [];
    for (const chunk of chunks) {
      fallbackResults.push(await embedChunk(chunk));
    }
    return fallbackResults;
  }
};

export interface EmbedKnowledgeChunksInput {
  userId: string;
  documentId?: string;
  limit?: number;
}

export interface EmbedKnowledgeChunksResult {
  documentId?: string;
  attemptedCount: number;
  readyCount: number;
  failedCount: number;
  skippedCount: number;
  processedChunkIds: string[];
  failures: Array<{
    chunkId: string;
    errorMessage: string;
  }>;
}

export const embedKnowledgeChunks = async ({
  userId,
  documentId,
  limit = 200,
}: EmbedKnowledgeChunksInput): Promise<EmbedKnowledgeChunksResult> => {
  const processedChunkIds: string[] = [];
  const results: EmbeddedChunkResult[] = [];
  while (true) {
    const chunks = await listKnowledgeChunksForEmbedding({
      userId,
      documentId,
      limit,
      statuses: ["pending", "failed"],
      excludeChunkIds: [...processedChunkIds],
    });

    if (chunks.length === 0) {
      break;
    }

    const configError = getEmbeddingConfigError();
    if (configError) {
      for (const chunk of chunks) {
        const result = await persistChunkEmbeddingFailure({
          chunk,
          errorMessage: configError,
        });
        processedChunkIds.push(chunk.id);
        results.push(result);
      }
      continue;
    }

    for (let index = 0; index < chunks.length; index += DEFAULT_EMBEDDING_BATCH_SIZE) {
      const batch = chunks.slice(index, index + DEFAULT_EMBEDDING_BATCH_SIZE);
      const batchResults = await embedChunkBatch(batch);
      processedChunkIds.push(...batchResults.map((result) => result.chunkId));
      results.push(...batchResults);
    }
  }

  const failures = results.reduce<Array<{ chunkId: string; errorMessage: string }>>(
    (items, result) => {
      if (result.status === "failed" && result.errorMessage) {
        items.push({
          chunkId: result.chunkId,
          errorMessage: result.errorMessage,
        });
      }

      return items;
    },
    [],
  );

  return {
    documentId,
    attemptedCount: results.length,
    readyCount: results.filter((result) => result.status === "ready").length,
    failedCount: failures.length,
    skippedCount: results.filter((result) => result.status === "skipped").length,
    processedChunkIds,
    failures,
  };
};
