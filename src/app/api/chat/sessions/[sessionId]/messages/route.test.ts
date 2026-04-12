import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSessionByIdMock,
  isDatabaseConfiguredMock,
  listMessagesBySessionMock,
  requireApiSessionMock,
} = vi.hoisted(() => ({
  getSessionByIdMock: vi.fn(),
  isDatabaseConfiguredMock: vi.fn(),
  listMessagesBySessionMock: vi.fn(),
  requireApiSessionMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireApiSession: requireApiSessionMock,
}));

vi.mock("@/lib/db/chat-session-repository", () => ({
  getSessionById: getSessionByIdMock,
  listMessagesBySession: listMessagesBySessionMock,
}));

vi.mock("@/lib/db/env", () => ({
  DATABASE_NOT_CONFIGURED_MESSAGE: "DATABASE_URL is not configured on the server.",
  isDatabaseConfigured: isDatabaseConfiguredMock,
}));

import { GET } from "./route";

describe("GET /api/chat/sessions/[sessionId]/messages", () => {
  beforeEach(() => {
    getSessionByIdMock.mockReset();
    isDatabaseConfiguredMock.mockReset();
    listMessagesBySessionMock.mockReset();
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

  it("returns only the current user's messages for the requested session", async () => {
    getSessionByIdMock.mockResolvedValueOnce({
      id: "session-1",
      userId: "user-1",
      title: "第一个会话",
      summary: "",
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T01:00:00.000Z",
      lastMessageAt: "2026-04-12T01:00:00.000Z",
    });
    listMessagesBySessionMock.mockResolvedValueOnce([
      {
        id: "message-1",
        sessionId: "session-1",
        role: "user",
        content: "hello",
        metadata: {},
        sequenceNo: 1,
        createdAt: "2026-04-12T00:00:01.000Z",
      },
    ]);

    const response = await GET(new Request("http://localhost/api/chat/sessions/session-1/messages"), {
      params: Promise.resolve({
        sessionId: "session-1",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      session: {
        id: "session-1",
        title: "第一个会话",
        createdAt: "2026-04-12T00:00:00.000Z",
        updatedAt: "2026-04-12T01:00:00.000Z",
        lastMessageAt: "2026-04-12T01:00:00.000Z",
      },
      items: [
        {
          id: "message-1",
          role: "user",
          content: "hello",
          metadata: {},
          createdAt: "2026-04-12T00:00:01.000Z",
        },
      ],
    });
  });

  it("returns 404 when the session does not belong to the current user", async () => {
    getSessionByIdMock.mockResolvedValueOnce(null);

    const response = await GET(new Request("http://localhost/api/chat/sessions/session-1/messages"), {
      params: Promise.resolve({
        sessionId: "session-1",
      }),
    });

    expect(response.status).toBe(404);
  });

  it("returns 503 when the database is unavailable", async () => {
    isDatabaseConfiguredMock.mockReturnValueOnce(false);

    const response = await GET(new Request("http://localhost/api/chat/sessions/session-1/messages"), {
      params: Promise.resolve({
        sessionId: "session-1",
      }),
    });

    expect(response.status).toBe(503);
  });
});
