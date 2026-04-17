import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  chunkTextMock,
  createKnowledgeDocumentMock,
  getDocumentTitleFromFilenameMock,
  getSupportedMimeTypeMock,
  parseKnowledgeFileMock,
  persistKnowledgeDocumentChunksMock,
  updateKnowledgeDocumentStatusMock,
} = vi.hoisted(() => ({
  chunkTextMock: vi.fn(),
  createKnowledgeDocumentMock: vi.fn(),
  getDocumentTitleFromFilenameMock: vi.fn(),
  getSupportedMimeTypeMock: vi.fn(),
  parseKnowledgeFileMock: vi.fn(),
  persistKnowledgeDocumentChunksMock: vi.fn(),
  updateKnowledgeDocumentStatusMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/db/knowledge-repository", () => ({
  createKnowledgeDocument: createKnowledgeDocumentMock,
  persistKnowledgeDocumentChunks: persistKnowledgeDocumentChunksMock,
  updateKnowledgeDocumentStatus: updateKnowledgeDocumentStatusMock,
}));

vi.mock("@/lib/knowledge/parser", () => ({
  getDocumentTitleFromFilename: getDocumentTitleFromFilenameMock,
  getSupportedMimeType: getSupportedMimeTypeMock,
  parseKnowledgeFile: parseKnowledgeFileMock,
}));

vi.mock("@/lib/knowledge/chunker", () => ({
  chunkText: chunkTextMock,
  knowledgeChunkDefaults: {
    targetChunkSize: 1200,
    overlapSize: 200,
  },
}));

import { ingestKnowledgeFile, KNOWLEDGE_MAX_FILE_SIZE_BYTES } from "./ingest";

describe("ingestKnowledgeFile", () => {
  beforeEach(() => {
    chunkTextMock.mockReset();
    createKnowledgeDocumentMock.mockReset();
    getDocumentTitleFromFilenameMock.mockReset();
    getSupportedMimeTypeMock.mockReset();
    parseKnowledgeFileMock.mockReset();
    persistKnowledgeDocumentChunksMock.mockReset();
    updateKnowledgeDocumentStatusMock.mockReset();

    getDocumentTitleFromFilenameMock.mockReturnValue("Policy");
    getSupportedMimeTypeMock.mockReturnValue("text/plain");
    createKnowledgeDocumentMock.mockResolvedValue({
      id: "doc-1",
      userId: "user-1",
      title: "Policy",
      originalFilename: "policy.txt",
      mimeType: "text/plain",
      fileSize: 12,
      extractedText: "",
      status: "uploaded",
      errorMessage: null,
      chunkCount: 0,
      createdAt: "2026-04-13T00:00:00.000Z",
      updatedAt: "2026-04-13T00:00:00.000Z",
    });
    parseKnowledgeFileMock.mockResolvedValue({
      mimeType: "text/plain",
      text: "Parsed text",
    });
    updateKnowledgeDocumentStatusMock.mockResolvedValue({
      id: "doc-1",
      userId: "user-1",
      title: "Policy",
      originalFilename: "policy.txt",
      mimeType: "text/plain",
      fileSize: 12,
      extractedText: "Parsed text",
      status: "parsed",
      errorMessage: null,
      chunkCount: 0,
      createdAt: "2026-04-13T00:00:00.000Z",
      updatedAt: "2026-04-13T00:00:02.000Z",
    });
    chunkTextMock.mockReturnValue([
      {
        chunkIndex: 0,
        content: "Parsed text",
        charCount: 11,
      },
    ]);
    persistKnowledgeDocumentChunksMock.mockResolvedValue({
      document: {
        id: "doc-1",
        userId: "user-1",
        title: "Policy",
        originalFilename: "policy.txt",
        mimeType: "text/plain",
        fileSize: 12,
        extractedText: "Parsed text",
        status: "chunked",
        errorMessage: null,
        chunkCount: 1,
        createdAt: "2026-04-13T00:00:00.000Z",
        updatedAt: "2026-04-13T00:00:03.000Z",
      },
      chunks: [],
    });
  });

  it("creates, parses, chunks, and finalizes a document", async () => {
    const file = new File(["Parsed text"], "policy.txt", { type: "text/plain" });

    const result = await ingestKnowledgeFile({
      userId: "user-1",
      file,
    });

    expect(createKnowledgeDocumentMock).toHaveBeenCalledWith({
      userId: "user-1",
      title: "Policy",
      originalFilename: "policy.txt",
      mimeType: "text/plain",
      fileSize: file.size,
      status: "uploaded",
    });
    expect(updateKnowledgeDocumentStatusMock).toHaveBeenNthCalledWith(1, {
      documentId: "doc-1",
      userId: "user-1",
      status: "parsed",
      extractedText: "Parsed text",
      errorMessage: null,
    });
    expect(persistKnowledgeDocumentChunksMock).toHaveBeenCalledTimes(1);
    expect(result.document.status).toBe("chunked");
  });

  it("marks the document as failed when parsing yields no extractable text", async () => {
    parseKnowledgeFileMock.mockResolvedValueOnce({
      mimeType: "text/plain",
      text: "   ",
    });

    const file = new File([""], "empty.txt", { type: "text/plain" });

    await expect(
      ingestKnowledgeFile({
        userId: "user-1",
        file,
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: "The uploaded document does not contain extractable text.",
    });

    expect(updateKnowledgeDocumentStatusMock).toHaveBeenCalledWith({
      documentId: "doc-1",
      userId: "user-1",
      status: "failed",
      errorMessage: "The uploaded document does not contain extractable text.",
    });
  });

  it("marks the document as failed when pdf parsing throws", async () => {
    getDocumentTitleFromFilenameMock.mockReturnValueOnce("Guide");
    getSupportedMimeTypeMock.mockReturnValueOnce("application/pdf");
    parseKnowledgeFileMock.mockRejectedValueOnce(
      new Error("Failed to parse PDF document. Setting up fake worker failed."),
    );

    const file = new File(["pdf"], "guide.pdf", { type: "application/pdf" });

    await expect(
      ingestKnowledgeFile({
        userId: "user-1",
        file,
      }),
    ).rejects.toMatchObject({
      status: 500,
      message: "Failed to parse PDF document. Setting up fake worker failed.",
    });

    expect(updateKnowledgeDocumentStatusMock).toHaveBeenCalledWith({
      documentId: "doc-1",
      userId: "user-1",
      status: "failed",
      errorMessage: "Failed to parse PDF document. Setting up fake worker failed.",
    });
  });

  it("rejects oversized files before creating a document record", async () => {
    const file = new File(["x"], "large.txt", { type: "text/plain" });
    Object.defineProperty(file, "size", {
      value: KNOWLEDGE_MAX_FILE_SIZE_BYTES + 1,
    });

    await expect(
      ingestKnowledgeFile({
        userId: "user-1",
        file,
      }),
    ).rejects.toMatchObject({
      status: 413,
      message: "File size exceeds the 5 MB limit.",
    });

    expect(createKnowledgeDocumentMock).not.toHaveBeenCalled();
  });
});
