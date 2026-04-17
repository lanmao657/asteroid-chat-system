import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  deleteKnowledgeDocumentMock,
  getKnowledgeDocumentByIdMock,
  isDatabaseConfiguredMock,
  requireApiSessionMock,
} = vi.hoisted(() => ({
  deleteKnowledgeDocumentMock: vi.fn(),
  getKnowledgeDocumentByIdMock: vi.fn(),
  isDatabaseConfiguredMock: vi.fn(),
  requireApiSessionMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireApiSession: requireApiSessionMock,
}));

vi.mock("@/lib/db/knowledge-repository", () => ({
  deleteKnowledgeDocument: deleteKnowledgeDocumentMock,
  getKnowledgeDocumentById: getKnowledgeDocumentByIdMock,
}));

vi.mock("@/lib/db/env", () => ({
  DATABASE_NOT_CONFIGURED_MESSAGE: "DATABASE_URL is not configured on the server.",
  isDatabaseConfigured: isDatabaseConfiguredMock,
}));

import { DELETE, GET } from "./route";

describe("GET/DELETE /api/knowledge/documents/[documentId]", () => {
  beforeEach(() => {
    deleteKnowledgeDocumentMock.mockReset();
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

  it("returns the requested document detail for the owning user", async () => {
    getKnowledgeDocumentByIdMock.mockResolvedValueOnce({
      id: "doc-1",
      userId: "user-1",
      title: "Policy",
      originalFilename: "policy.txt",
      mimeType: "text/plain",
      fileSize: 128,
      extractedText: "full content",
      status: "chunked",
      errorMessage: null,
      chunkCount: 2,
      createdAt: "2026-04-13T00:00:00.000Z",
      updatedAt: "2026-04-13T00:01:00.000Z",
    });

    const response = await GET(
      new Request("http://localhost/api/knowledge/documents/doc-1"),
      {
        params: Promise.resolve({
          documentId: "doc-1",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(getKnowledgeDocumentByIdMock).toHaveBeenCalledWith({
      documentId: "doc-1",
      userId: "user-1",
    });
    await expect(response.json()).resolves.toEqual({
      item: {
        id: "doc-1",
        title: "Policy",
        originalFilename: "policy.txt",
        mimeType: "text/plain",
        fileSize: 128,
        status: "chunked",
        chunkCount: 2,
        createdAt: "2026-04-13T00:00:00.000Z",
        updatedAt: "2026-04-13T00:01:00.000Z",
        extractedText: "full content",
        errorMessage: null,
      },
    });
  });

  it("returns 404 when the document does not belong to the current user", async () => {
    getKnowledgeDocumentByIdMock.mockResolvedValueOnce(null);

    const response = await GET(
      new Request("http://localhost/api/knowledge/documents/doc-404"),
      {
        params: Promise.resolve({
          documentId: "doc-404",
        }),
      },
    );

    expect(response.status).toBe(404);
  });

  it("deletes the requested document", async () => {
    deleteKnowledgeDocumentMock.mockResolvedValueOnce(true);

    const response = await DELETE(
      new Request("http://localhost/api/knowledge/documents/doc-1", {
        method: "DELETE",
      }),
      {
        params: Promise.resolve({
          documentId: "doc-1",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "doc-1",
      deleted: true,
    });
  });

  it("returns 404 when deleting another user's document", async () => {
    deleteKnowledgeDocumentMock.mockResolvedValueOnce(false);

    const response = await DELETE(
      new Request("http://localhost/api/knowledge/documents/doc-404", {
        method: "DELETE",
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

    const response = await GET(
      new Request("http://localhost/api/knowledge/documents/doc-1"),
      {
        params: Promise.resolve({
          documentId: "doc-1",
        }),
      },
    );

    expect(response.status).toBe(503);
  });
});
