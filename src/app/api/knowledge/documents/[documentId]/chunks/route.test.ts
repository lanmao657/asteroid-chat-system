import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getKnowledgeDocumentByIdMock,
  isDatabaseConfiguredMock,
  listKnowledgeChunksByDocumentMock,
  requireApiSessionMock,
} = vi.hoisted(() => ({
  getKnowledgeDocumentByIdMock: vi.fn(),
  isDatabaseConfiguredMock: vi.fn(),
  listKnowledgeChunksByDocumentMock: vi.fn(),
  requireApiSessionMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireApiSession: requireApiSessionMock,
}));

vi.mock("@/lib/db/knowledge-repository", () => ({
  getKnowledgeDocumentById: getKnowledgeDocumentByIdMock,
  listKnowledgeChunksByDocument: listKnowledgeChunksByDocumentMock,
}));

vi.mock("@/lib/db/env", () => ({
  DATABASE_NOT_CONFIGURED_MESSAGE: "DATABASE_URL is not configured on the server.",
  isDatabaseConfigured: isDatabaseConfiguredMock,
}));

import { GET } from "./route";

describe("GET /api/knowledge/documents/[documentId]/chunks", () => {
  beforeEach(() => {
    getKnowledgeDocumentByIdMock.mockReset();
    isDatabaseConfiguredMock.mockReset();
    listKnowledgeChunksByDocumentMock.mockReset();
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

  it("returns chunks for the current user's document", async () => {
    getKnowledgeDocumentByIdMock.mockResolvedValueOnce({
      id: "doc-1",
    });
    listKnowledgeChunksByDocumentMock.mockResolvedValueOnce([
      {
        id: "chunk-1",
        documentId: "doc-1",
        userId: "user-1",
        chunkIndex: 0,
        content: "First chunk",
        charCount: 11,
        embeddingStatus: "pending",
        metadata: {},
        createdAt: "2026-04-13T00:02:00.000Z",
      },
    ]);

    const response = await GET(
      new Request("http://localhost/api/knowledge/documents/doc-1/chunks"),
      {
        params: Promise.resolve({
          documentId: "doc-1",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(listKnowledgeChunksByDocumentMock).toHaveBeenCalledWith({
      documentId: "doc-1",
      userId: "user-1",
    });
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          id: "chunk-1",
          documentId: "doc-1",
          userId: "user-1",
          chunkIndex: 0,
          content: "First chunk",
          charCount: 11,
          embeddingStatus: "pending",
          metadata: {},
          createdAt: "2026-04-13T00:02:00.000Z",
        },
      ],
    });
  });

  it("returns 404 for unauthorized access to another user's chunks", async () => {
    getKnowledgeDocumentByIdMock.mockResolvedValueOnce(null);

    const response = await GET(
      new Request("http://localhost/api/knowledge/documents/doc-404/chunks"),
      {
        params: Promise.resolve({
          documentId: "doc-404",
        }),
      },
    );

    expect(response.status).toBe(404);
  });
});
