import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  ingestKnowledgeFileMock,
  isDatabaseConfiguredMock,
  listKnowledgeDocumentsByUserMock,
  requireApiSessionMock,
} = vi.hoisted(() => ({
  ingestKnowledgeFileMock: vi.fn(),
  isDatabaseConfiguredMock: vi.fn(),
  listKnowledgeDocumentsByUserMock: vi.fn(),
  requireApiSessionMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/session", () => ({
  requireApiSession: requireApiSessionMock,
}));

vi.mock("@/lib/db/knowledge-repository", () => ({
  listKnowledgeDocumentsByUser: listKnowledgeDocumentsByUserMock,
}));

vi.mock("@/lib/db/env", () => ({
  DATABASE_NOT_CONFIGURED_MESSAGE: "DATABASE_URL is not configured on the server.",
  isDatabaseConfigured: isDatabaseConfiguredMock,
}));

vi.mock("@/lib/knowledge/ingest", async () => {
  const actual = await vi.importActual<typeof import("@/lib/knowledge/ingest")>(
    "@/lib/knowledge/ingest",
  );

  return {
    ...actual,
    ingestKnowledgeFile: ingestKnowledgeFileMock,
  };
});

import { KnowledgeIngestError } from "@/lib/knowledge/ingest";
import { GET, POST } from "./route";

describe("GET/POST /api/knowledge/documents", () => {
  beforeEach(() => {
    ingestKnowledgeFileMock.mockReset();
    isDatabaseConfiguredMock.mockReset();
    listKnowledgeDocumentsByUserMock.mockReset();
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

  it("returns the current user's knowledge documents", async () => {
    listKnowledgeDocumentsByUserMock.mockResolvedValueOnce([
      {
        id: "doc-1",
        userId: "user-1",
        title: "Policy",
        originalFilename: "policy.txt",
        mimeType: "text/plain",
        fileSize: 128,
        extractedText: "content",
        status: "chunked",
        errorMessage: null,
        chunkCount: 2,
        createdAt: "2026-04-13T00:00:00.000Z",
        updatedAt: "2026-04-13T00:01:00.000Z",
      },
    ]);

    const response = await GET(new Request("http://localhost/api/knowledge/documents?limit=20"));

    expect(response.status).toBe(200);
    expect(listKnowledgeDocumentsByUserMock).toHaveBeenCalledWith({
      userId: "user-1",
      limit: 20,
    });
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          id: "doc-1",
          title: "Policy",
          originalFilename: "policy.txt",
          mimeType: "text/plain",
          fileSize: 128,
          status: "chunked",
          chunkCount: 2,
          createdAt: "2026-04-13T00:00:00.000Z",
          updatedAt: "2026-04-13T00:01:00.000Z",
        },
      ],
    });
  });

  it("uploads a supported file and returns the created document summary", async () => {
    ingestKnowledgeFileMock.mockResolvedValueOnce({
      document: {
        id: "doc-1",
        userId: "user-1",
        title: "Policy",
        originalFilename: "policy.txt",
        mimeType: "text/plain",
        fileSize: 128,
        extractedText: "content",
        status: "chunked",
        errorMessage: null,
        chunkCount: 2,
        createdAt: "2026-04-13T00:00:00.000Z",
        updatedAt: "2026-04-13T00:01:00.000Z",
      },
    });

    const formData = new FormData();
    formData.set("file", new File(["policy text"], "policy.txt", { type: "text/plain" }));

    const response = await POST(
      new Request("http://localhost/api/knowledge/documents", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(201);
    expect(ingestKnowledgeFileMock).toHaveBeenCalledTimes(1);
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
      },
    });
  });

  it("returns 400 when the upload is missing a file", async () => {
    const response = await POST(
      new Request("http://localhost/api/knowledge/documents", {
        method: "POST",
        body: new FormData(),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("returns 413 for oversized uploads", async () => {
    ingestKnowledgeFileMock.mockRejectedValueOnce(
      new KnowledgeIngestError("File size exceeds the 5 MB limit.", 413),
    );

    const formData = new FormData();
    formData.set("file", new File(["test"], "large.pdf", { type: "application/pdf" }));

    const response = await POST(
      new Request("http://localhost/api/knowledge/documents", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(413);
  });

  it("returns 415 for unsupported file types", async () => {
    ingestKnowledgeFileMock.mockRejectedValueOnce(
      new KnowledgeIngestError("Unsupported file type. Only txt, md, and pdf are allowed.", 415),
    );

    const formData = new FormData();
    formData.set("file", new File(["binary"], "image.png", { type: "image/png" }));

    const response = await POST(
      new Request("http://localhost/api/knowledge/documents", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(415);
  });

  it("returns 422 when parsing fails after the document is created", async () => {
    ingestKnowledgeFileMock.mockRejectedValueOnce(
      new KnowledgeIngestError("The uploaded document does not contain extractable text.", 422),
    );

    const formData = new FormData();
    formData.set("file", new File([""], "empty.pdf", { type: "application/pdf" }));

    const response = await POST(
      new Request("http://localhost/api/knowledge/documents", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "The uploaded document does not contain extractable text.",
    });
  });

  it("returns 401 when the user is not authenticated", async () => {
    requireApiSessionMock.mockResolvedValueOnce({
      response: Response.json({ error: "Authentication required." }, { status: 401 }),
      session: null,
    });

    const response = await GET(new Request("http://localhost/api/knowledge/documents"));

    expect(response.status).toBe(401);
  });

  it("returns 503 when the database is unavailable", async () => {
    isDatabaseConfiguredMock.mockReturnValueOnce(false);

    const response = await GET(new Request("http://localhost/api/knowledge/documents"));

    expect(response.status).toBe(503);
  });
});
