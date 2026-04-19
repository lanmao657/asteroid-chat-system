import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  connectMock,
  ensureDatabaseSchema,
  getDbPoolMock,
  query,
  releaseMock,
  transactionQuery,
} = vi.hoisted(() => ({
  query: vi.fn(),
  transactionQuery: vi.fn(),
  releaseMock: vi.fn(),
  connectMock: vi.fn(),
  ensureDatabaseSchema: vi.fn(async () => true),
  getDbPoolMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("./client", () => ({
  getDbPool: getDbPoolMock,
}));

vi.mock("./schema", () => ({
  KNOWLEDGE_DOCUMENTS_TABLE: "knowledge_documents",
  KNOWLEDGE_CHUNKS_TABLE: "knowledge_chunks",
  ensureDatabaseSchema,
}));

import {
  bulkInsertKnowledgeChunks,
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  getKnowledgeChunksByIds,
  getKnowledgeDocumentMetaByIds,
  getKnowledgeDocumentById,
  listKnowledgeChunksByDocument,
  listKnowledgeDocumentsByUser,
  persistKnowledgeDocumentChunks,
  searchKnowledgeChunksByUser,
  updateKnowledgeDocumentStatus,
} from "./knowledge-repository";

describe("knowledge-repository", () => {
  beforeEach(() => {
    query.mockReset();
    transactionQuery.mockReset();
    releaseMock.mockReset();
    connectMock.mockReset();
    ensureDatabaseSchema.mockClear();
    getDbPoolMock.mockReset();

    connectMock.mockResolvedValue({
      query: transactionQuery,
      release: releaseMock,
    });

    getDbPoolMock.mockReturnValue({
      query,
      connect: connectMock,
    });
  });

  it("creates a knowledge document for the current user", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "doc-1",
          user_id: "user-1",
          title: "Policy",
          original_filename: "policy.txt",
          mime_type: "text/plain",
          file_size: 128,
          extracted_text: "",
          status: "uploaded",
          error_message: null,
          chunk_count: 0,
          created_at: new Date("2026-04-13T00:00:00.000Z"),
          updated_at: new Date("2026-04-13T00:00:00.000Z"),
        },
      ],
    });

    const result = await createKnowledgeDocument({
      userId: "user-1",
      title: "Policy",
      originalFilename: "policy.txt",
      mimeType: "text/plain",
      fileSize: 128,
    });

    expect(ensureDatabaseSchema).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      id: "doc-1",
      userId: "user-1",
      title: "Policy",
      originalFilename: "policy.txt",
      mimeType: "text/plain",
      fileSize: 128,
      extractedText: "",
      status: "uploaded",
      errorMessage: null,
      chunkCount: 0,
      createdAt: "2026-04-13T00:00:00.000Z",
      updatedAt: "2026-04-13T00:00:00.000Z",
    });
  });

  it("updates document status and preserves user isolation", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "doc-1",
          user_id: "user-1",
          title: "Policy",
          original_filename: "policy.txt",
          mime_type: "text/plain",
          file_size: 128,
          extracted_text: "parsed text",
          status: "parsed",
          error_message: null,
          chunk_count: 0,
          created_at: new Date("2026-04-13T00:00:00.000Z"),
          updated_at: new Date("2026-04-13T00:00:03.000Z"),
        },
      ],
    });

    const result = await updateKnowledgeDocumentStatus({
      documentId: "doc-1",
      userId: "user-1",
      status: "parsed",
      extractedText: "parsed text",
      errorMessage: null,
    });

    expect(query.mock.calls[0]?.[1]).toEqual(["doc-1", "user-1", "parsed", "parsed text", null]);
    expect(result?.status).toBe("parsed");
  });

  it("lists documents for the owning user only", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "doc-1",
          user_id: "user-1",
          title: "Policy",
          original_filename: "policy.txt",
          mime_type: "text/plain",
          file_size: "128",
          extracted_text: "content",
          status: "chunked",
          error_message: null,
          chunk_count: 3,
          created_at: new Date("2026-04-13T00:00:00.000Z"),
          updated_at: new Date("2026-04-13T00:01:00.000Z"),
        },
      ],
    });

    const result = await listKnowledgeDocumentsByUser({
      userId: "user-1",
      limit: 10,
    });

    expect(query.mock.calls[0]?.[1]).toEqual(["user-1", 10]);
    expect(result[0]?.fileSize).toBe(128);
  });

  it("returns null when the document does not belong to the current user", async () => {
    query.mockResolvedValueOnce({
      rows: [],
    });

    await expect(
      getKnowledgeDocumentById({
        documentId: "doc-404",
        userId: "user-2",
      }),
    ).resolves.toBeNull();
  });

  it("bulk inserts chunks for the owning user", async () => {
    query
      .mockResolvedValueOnce({
        rows: [{ id: "doc-1" }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "chunk-1",
            document_id: "doc-1",
            user_id: "user-1",
            chunk_index: 0,
            content: "First chunk",
            char_count: 11,
            embedding_status: "pending",
            metadata: {},
            created_at: new Date("2026-04-13T00:02:00.000Z"),
          },
        ],
      });

    const result = await bulkInsertKnowledgeChunks({
      documentId: "doc-1",
      userId: "user-1",
      chunks: [
        {
          chunkIndex: 0,
          content: "First chunk",
          charCount: 11,
        },
      ],
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(result[0]?.documentId).toBe("doc-1");
    expect(result[0]?.chunkIndex).toBe(0);
  });

  it("persists chunks and marks the document as chunked in one transaction", async () => {
    transactionQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "doc-1" }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "chunk-1",
            document_id: "doc-1",
            user_id: "user-1",
            chunk_index: 0,
            content: "First chunk",
            char_count: 11,
            embedding_status: "pending",
            metadata: {},
            created_at: new Date("2026-04-13T00:02:00.000Z"),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "doc-1",
            user_id: "user-1",
            title: "Policy",
            original_filename: "policy.txt",
            mime_type: "text/plain",
            file_size: 128,
            extracted_text: "parsed text",
            status: "chunked",
            error_message: null,
            chunk_count: 1,
            created_at: new Date("2026-04-13T00:00:00.000Z"),
            updated_at: new Date("2026-04-13T00:03:00.000Z"),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await persistKnowledgeDocumentChunks({
      documentId: "doc-1",
      userId: "user-1",
      chunks: [
        {
          chunkIndex: 0,
          content: "First chunk",
          charCount: 11,
        },
      ],
    });

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(transactionQuery).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(transactionQuery).toHaveBeenNthCalledWith(5, "COMMIT");
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(result.document.status).toBe("chunked");
    expect(result.document.chunkCount).toBe(1);
  });

  it("rejects empty chunks before marking the document as chunked", async () => {
    await expect(
      persistKnowledgeDocumentChunks({
        documentId: "doc-1",
        userId: "user-1",
        chunks: [],
      }),
    ).rejects.toThrow("Knowledge document did not produce any chunks.");

    expect(connectMock).not.toHaveBeenCalled();
    expect(transactionQuery).not.toHaveBeenCalled();
  });

  it("lists chunks in chunk index order", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "chunk-1",
          document_id: "doc-1",
          user_id: "user-1",
          chunk_index: 0,
          content: "First chunk",
          char_count: 11,
          embedding_status: "pending",
          metadata: {},
          created_at: new Date("2026-04-13T00:02:00.000Z"),
        },
      ],
    });

    const result = await listKnowledgeChunksByDocument({
      documentId: "doc-1",
      userId: "user-1",
    });

    expect(query.mock.calls[0]?.[1]).toEqual(["doc-1", "user-1"]);
    expect(result[0]?.chunkIndex).toBe(0);
  });

  it("deletes a document and relies on database cascade for chunks", async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: "doc-1" }],
    });

    await expect(
      deleteKnowledgeDocument({
        documentId: "doc-1",
        userId: "user-1",
      }),
    ).resolves.toBe(true);

    expect(String(query.mock.calls[0]?.[0])).toContain("DELETE FROM knowledge_documents");
  });

  it("searches chunk candidates for the owning user and returns stable scores", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          chunk_id: "chunk-1",
          document_id: "doc-1",
          chunk_index: 0,
          content: "退款处理需要先确认订单状态，再同步到账时效。",
          document_title: "退款处理 SOP",
          fts_score: "0.62",
        },
      ],
    });

    const results = await searchKnowledgeChunksByUser({
      userId: "user-1",
      query: "退款处理 到账时效",
      topK: 5,
      minScore: 0.1,
      mode: "fts",
    });

    expect(query.mock.calls[0]?.[1]).toEqual([
      "user-1",
      "退款处理 到账时效",
      expect.any(Array),
      30,
      true,
      true,
    ]);
    expect(results).toEqual([
      expect.objectContaining({
        documentId: "doc-1",
        chunkId: "chunk-1",
        documentTitle: "退款处理 SOP",
        sourceType: "knowledge_base",
      }),
    ]);
    expect(results[0]?.score).toBeGreaterThan(0.1);
  });

  it("filters out weak chunk candidates below the minScore threshold", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          chunk_id: "chunk-2",
          document_id: "doc-2",
          chunk_index: 1,
          content: "泛化说明",
          document_title: "一般说明",
          fts_score: "0",
        },
      ],
    });

    await expect(
      searchKnowledgeChunksByUser({
        userId: "user-1",
        query: "退款争议",
        minScore: 0.9,
      }),
    ).resolves.toEqual([]);
  });

  it("loads chunks and document metadata by ids within the same user scope", async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "chunk-1",
            document_id: "doc-1",
            user_id: "user-1",
            chunk_index: 0,
            content: "First chunk",
            char_count: 11,
            embedding_status: "pending",
            metadata: {},
            created_at: new Date("2026-04-13T00:02:00.000Z"),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "doc-1",
            title: "Policy",
            status: "chunked",
            updated_at: new Date("2026-04-13T00:03:00.000Z"),
          },
        ],
      });

    const chunks = await getKnowledgeChunksByIds({
      userId: "user-1",
      chunkIds: ["chunk-1"],
    });
    const metas = await getKnowledgeDocumentMetaByIds({
      userId: "user-1",
      documentIds: ["doc-1"],
    });

    expect(chunks[0]?.id).toBe("chunk-1");
    expect(metas).toEqual([
      {
        documentId: "doc-1",
        title: "Policy",
        status: "chunked",
        updatedAt: "2026-04-13T00:03:00.000Z",
      },
    ]);
  });

  it("throws a clear error when the database is unavailable", async () => {
    getDbPoolMock.mockReturnValueOnce(null);

    await expect(
      listKnowledgeDocumentsByUser({
        userId: "user-1",
      }),
    ).rejects.toThrow("DATABASE_URL is not configured on the server.");
  });
});
