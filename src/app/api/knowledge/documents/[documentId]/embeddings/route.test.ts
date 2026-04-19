import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  embedKnowledgeChunksMock,
  getKnowledgeDocumentByIdMock,
  isDatabaseConfiguredMock,
  requireApiSessionMock,
} = vi.hoisted(() => ({
  embedKnowledgeChunksMock: vi.fn(),
  getKnowledgeDocumentByIdMock: vi.fn(),
  isDatabaseConfiguredMock: vi.fn(),
  requireApiSessionMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireApiSession: requireApiSessionMock,
}));

vi.mock("@/lib/db/knowledge-repository", () => ({
  getKnowledgeDocumentById: getKnowledgeDocumentByIdMock,
}));

vi.mock("@/lib/db/env", () => ({
  DATABASE_NOT_CONFIGURED_MESSAGE: "DATABASE_URL is not configured on the server.",
  isDatabaseConfigured: isDatabaseConfiguredMock,
}));

vi.mock("@/lib/knowledge/embedding", () => ({
  embedKnowledgeChunks: embedKnowledgeChunksMock,
}));

import { POST } from "./route";

describe("POST /api/knowledge/documents/[documentId]/embeddings", () => {
  beforeEach(() => {
    embedKnowledgeChunksMock.mockReset();
    getKnowledgeDocumentByIdMock.mockReset();
    isDatabaseConfiguredMock.mockReset();
    requireApiSessionMock.mockReset();

    requireApiSessionMock.mockResolvedValue({
      response: null,
      session: {
        user: {
          id: "user-1",
        },
      },
    });
    isDatabaseConfiguredMock.mockReturnValue(true);
  });

  it("embeds chunks for the owning user document", async () => {
    getKnowledgeDocumentByIdMock.mockResolvedValueOnce({
      id: "doc-1",
      chunkCount: 2,
    });
    embedKnowledgeChunksMock.mockResolvedValueOnce({
      documentId: "doc-1",
      attemptedCount: 2,
      readyCount: 1,
      failedCount: 1,
      skippedCount: 1,
      processedChunkIds: ["chunk-1", "chunk-2"],
      failures: [
        {
          chunkId: "chunk-2",
          errorMessage: "rate limited",
        },
      ],
    });

    const response = await POST(
      new Request("http://localhost/api/knowledge/documents/doc-1/embeddings", {
        method: "POST",
      }),
      {
        params: Promise.resolve({
          documentId: "doc-1",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(embedKnowledgeChunksMock).toHaveBeenCalledWith({
      userId: "user-1",
      documentId: "doc-1",
      limit: 2,
    });
    await expect(response.json()).resolves.toEqual({
      documentId: "doc-1",
      attemptedCount: 2,
      readyCount: 1,
      failedCount: 1,
      skippedCount: 1,
      failures: [
        {
          chunkId: "chunk-2",
          errorMessage: "rate limited",
        },
      ],
    });
  });

  it("returns 404 when the document does not belong to the current user", async () => {
    getKnowledgeDocumentByIdMock.mockResolvedValueOnce(null);

    const response = await POST(
      new Request("http://localhost/api/knowledge/documents/doc-404/embeddings", {
        method: "POST",
      }),
      {
        params: Promise.resolve({
          documentId: "doc-404",
        }),
      },
    );

    expect(response.status).toBe(404);
  });

  it("returns 503 when the database is unavailable", async () => {
    isDatabaseConfiguredMock.mockReturnValueOnce(false);

    const response = await POST(
      new Request("http://localhost/api/knowledge/documents/doc-1/embeddings", {
        method: "POST",
      }),
      {
        params: Promise.resolve({
          documentId: "doc-1",
        }),
      },
    );

    expect(response.status).toBe(503);
  });
});
