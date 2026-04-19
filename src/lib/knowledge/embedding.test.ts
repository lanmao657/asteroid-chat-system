import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listKnowledgeChunksForEmbeddingMock,
  updateKnowledgeChunkEmbeddingMock,
} = vi.hoisted(() => ({
  listKnowledgeChunksForEmbeddingMock: vi.fn(),
  updateKnowledgeChunkEmbeddingMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/db/knowledge-repository", () => ({
  listKnowledgeChunksForEmbedding: listKnowledgeChunksForEmbeddingMock,
  updateKnowledgeChunkEmbedding: updateKnowledgeChunkEmbeddingMock,
}));

vi.mock("@/lib/agent/env", () => ({
  agentEnv: {
    openAiCompatBaseUrl: "https://example.com/v1",
    openAiCompatApiKey: "test-key",
    knowledgeBaseEmbeddingModel: "text-embedding-3-small",
    knowledgeBaseEmbeddingBatchSize: 2,
    knowledgeBaseEmbeddingTimeoutMs: 30_000,
  },
}));

import { agentEnv } from "@/lib/agent/env";
import { embedKnowledgeChunks } from "./embedding";

describe("embedKnowledgeChunks", () => {
  beforeEach(() => {
    listKnowledgeChunksForEmbeddingMock.mockReset();
    updateKnowledgeChunkEmbeddingMock.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    agentEnv.openAiCompatApiKey = "test-key";
    agentEnv.knowledgeBaseEmbeddingModel = "text-embedding-3-small";
    updateKnowledgeChunkEmbeddingMock.mockResolvedValue({
      record: null,
      skipped: false,
    });
  });

  it("embeds pending chunks in batches and marks them ready", async () => {
    listKnowledgeChunksForEmbeddingMock
      .mockResolvedValueOnce([
        {
          id: "chunk-1",
          documentId: "doc-1",
          userId: "user-1",
          chunkIndex: 0,
          content: "First chunk",
          charCount: 11,
          embeddingStatus: "pending",
          embedding: null,
          embeddingErrorMessage: null,
          metadata: {},
          createdAt: "2026-04-19T00:00:00.000Z",
        },
        {
          id: "chunk-2",
          documentId: "doc-1",
          userId: "user-1",
          chunkIndex: 1,
          content: "Second chunk",
          charCount: 12,
          embeddingStatus: "pending",
          embedding: null,
          embeddingErrorMessage: null,
          metadata: {},
          createdAt: "2026-04-19T00:00:01.000Z",
        },
      ])
      .mockResolvedValueOnce([]);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { index: 1, embedding: [0.3, 0.4] },
            { index: 0, embedding: [0.1, 0.2] },
          ],
        }),
      }),
    );

    const result = await embedKnowledgeChunks({
      userId: "user-1",
      documentId: "doc-1",
      limit: 10,
    });

    expect(listKnowledgeChunksForEmbeddingMock).toHaveBeenCalledWith({
      userId: "user-1",
      documentId: "doc-1",
      limit: 10,
      statuses: ["pending", "failed"],
      excludeChunkIds: [],
    });
    expect(listKnowledgeChunksForEmbeddingMock).toHaveBeenNthCalledWith(2, {
      userId: "user-1",
      documentId: "doc-1",
      limit: 10,
      statuses: ["pending", "failed"],
      excludeChunkIds: ["chunk-1", "chunk-2"],
    });
    expect(updateKnowledgeChunkEmbeddingMock).toHaveBeenNthCalledWith(1, {
      chunkId: "chunk-1",
      userId: "user-1",
      embeddingStatus: "ready",
      embeddingVector: [0.1, 0.2],
      embeddingProvider: "openai-compatible",
      embeddingModel: "text-embedding-3-small",
      embeddingDimensions: 2,
      embeddingErrorMessage: null,
      skipIfAlreadyReady: true,
    });
    expect(updateKnowledgeChunkEmbeddingMock).toHaveBeenNthCalledWith(2, {
      chunkId: "chunk-2",
      userId: "user-1",
      embeddingStatus: "ready",
      embeddingVector: [0.3, 0.4],
      embeddingProvider: "openai-compatible",
      embeddingModel: "text-embedding-3-small",
      embeddingDimensions: 2,
      embeddingErrorMessage: null,
      skipIfAlreadyReady: true,
    });
    expect(result).toEqual({
      documentId: "doc-1",
      attemptedCount: 2,
      readyCount: 2,
      failedCount: 0,
      skippedCount: 0,
      processedChunkIds: ["chunk-1", "chunk-2"],
      failures: [],
    });
  });

  it("falls back to per-chunk embedding when the batch request fails", async () => {
    listKnowledgeChunksForEmbeddingMock
      .mockResolvedValueOnce([
        {
          id: "chunk-1",
          documentId: "doc-1",
          userId: "user-1",
          chunkIndex: 0,
          content: "First chunk",
          charCount: 11,
          embeddingStatus: "pending",
          embedding: null,
          embeddingErrorMessage: null,
          metadata: {},
          createdAt: "2026-04-19T00:00:00.000Z",
        },
        {
          id: "chunk-2",
          documentId: "doc-1",
          userId: "user-1",
          chunkIndex: 1,
          content: "Second chunk",
          charCount: 12,
          embeddingStatus: "pending",
          embedding: null,
          embeddingErrorMessage: null,
          metadata: {},
          createdAt: "2026-04-19T00:00:01.000Z",
        },
      ])
      .mockResolvedValueOnce([]);

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => "batch failed",
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{ index: 0, embedding: [0.1, 0.2] }],
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => "too many requests",
        }),
    );

    const result = await embedKnowledgeChunks({
      userId: "user-1",
      documentId: "doc-1",
    });

    expect(updateKnowledgeChunkEmbeddingMock).toHaveBeenNthCalledWith(1, {
      chunkId: "chunk-1",
      userId: "user-1",
      embeddingStatus: "ready",
      embeddingVector: [0.1, 0.2],
      embeddingProvider: "openai-compatible",
      embeddingModel: "text-embedding-3-small",
      embeddingDimensions: 2,
      embeddingErrorMessage: null,
      skipIfAlreadyReady: true,
    });
    expect(updateKnowledgeChunkEmbeddingMock).toHaveBeenNthCalledWith(2, {
      chunkId: "chunk-2",
      userId: "user-1",
      embeddingStatus: "failed",
      embeddingVector: null,
      embeddingProvider: null,
      embeddingModel: null,
      embeddingDimensions: null,
      embeddingErrorMessage:
        "Embedding request failed with status 429: too many requests",
      skipIfAlreadyReady: true,
    });
    expect(result.readyCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.failures).toEqual([
      {
        chunkId: "chunk-2",
        errorMessage: "Embedding request failed with status 429: too many requests",
      },
    ]);
  });

  it("marks chunks failed when embedding config is missing", async () => {
    agentEnv.openAiCompatApiKey = "";
    listKnowledgeChunksForEmbeddingMock
      .mockResolvedValueOnce([
        {
          id: "chunk-1",
          documentId: "doc-1",
          userId: "user-1",
          chunkIndex: 0,
          content: "First chunk",
          charCount: 11,
          embeddingStatus: "pending",
          embedding: null,
          embeddingErrorMessage: null,
          metadata: {},
          createdAt: "2026-04-19T00:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([]);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await embedKnowledgeChunks({
      userId: "user-1",
      documentId: "doc-1",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateKnowledgeChunkEmbeddingMock).toHaveBeenCalledWith({
      chunkId: "chunk-1",
      userId: "user-1",
      embeddingStatus: "failed",
      embeddingVector: null,
      embeddingProvider: null,
      embeddingModel: null,
      embeddingDimensions: null,
      embeddingErrorMessage:
        "Embedding API is not configured. Please set OPENAI_COMPAT_API_KEY.",
      skipIfAlreadyReady: true,
    });
    expect(result.failedCount).toBe(1);
  });

  it("counts concurrent ready chunk races as skipped instead of failed", async () => {
    listKnowledgeChunksForEmbeddingMock
      .mockResolvedValueOnce([
        {
          id: "chunk-1",
          documentId: "doc-1",
          userId: "user-1",
          chunkIndex: 0,
          content: "First chunk",
          charCount: 11,
          embeddingStatus: "pending",
          embedding: null,
          embeddingErrorMessage: null,
          metadata: {},
          createdAt: "2026-04-19T00:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([]);
    updateKnowledgeChunkEmbeddingMock.mockResolvedValueOnce({
      record: null,
      skipped: true,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "too many requests",
      }),
    );

    const result = await embedKnowledgeChunks({
      userId: "user-1",
      documentId: "doc-1",
    });

    expect(result).toEqual({
      documentId: "doc-1",
      attemptedCount: 1,
      readyCount: 0,
      failedCount: 0,
      skippedCount: 1,
      processedChunkIds: ["chunk-1"],
      failures: [],
    });
  });

  it("continues fetching later chunk pages for the same document", async () => {
    listKnowledgeChunksForEmbeddingMock
      .mockResolvedValueOnce([
        {
          id: "chunk-1",
          documentId: "doc-1",
          userId: "user-1",
          chunkIndex: 0,
          content: "First chunk",
          charCount: 11,
          embeddingStatus: "pending",
          embedding: null,
          embeddingErrorMessage: null,
          metadata: {},
          createdAt: "2026-04-19T00:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "chunk-2",
          documentId: "doc-1",
          userId: "user-1",
          chunkIndex: 1,
          content: "Second chunk",
          charCount: 12,
          embeddingStatus: "pending",
          embedding: null,
          embeddingErrorMessage: null,
          metadata: {},
          createdAt: "2026-04-19T00:00:01.000Z",
        },
      ])
      .mockResolvedValueOnce([]);

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{ index: 0, embedding: [0.1, 0.2] }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{ index: 0, embedding: [0.3, 0.4] }],
          }),
        }),
    );

    const result = await embedKnowledgeChunks({
      userId: "user-1",
      documentId: "doc-1",
      limit: 1,
    });

    expect(listKnowledgeChunksForEmbeddingMock).toHaveBeenNthCalledWith(1, {
      userId: "user-1",
      documentId: "doc-1",
      limit: 1,
      statuses: ["pending", "failed"],
      excludeChunkIds: [],
    });
    expect(listKnowledgeChunksForEmbeddingMock).toHaveBeenNthCalledWith(2, {
      userId: "user-1",
      documentId: "doc-1",
      limit: 1,
      statuses: ["pending", "failed"],
      excludeChunkIds: ["chunk-1"],
    });
    expect(listKnowledgeChunksForEmbeddingMock).toHaveBeenNthCalledWith(3, {
      userId: "user-1",
      documentId: "doc-1",
      limit: 1,
      statuses: ["pending", "failed"],
      excludeChunkIds: ["chunk-1", "chunk-2"],
    });
    expect(result.processedChunkIds).toEqual(["chunk-1", "chunk-2"]);
    expect(result.readyCount).toBe(2);
  });
});
