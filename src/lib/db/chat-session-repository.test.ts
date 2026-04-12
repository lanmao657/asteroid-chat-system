import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensureDatabaseSchema, getDbPoolMock, query } = vi.hoisted(() => ({
  query: vi.fn(),
  ensureDatabaseSchema: vi.fn(async () => true),
  getDbPoolMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("./client", () => ({
  getDbPool: getDbPoolMock,
}));

vi.mock("./schema", () => ({
  CHAT_MESSAGES_TABLE: "chat_messages",
  CHAT_SESSIONS_TABLE: "chat_sessions",
  ensureDatabaseSchema,
}));

import {
  appendMessage,
  createSession,
  getSessionById,
  listMessagesBySession,
  listSessionsByUser,
  updateSessionTitle,
} from "./chat-session-repository";

describe("chat-session-repository", () => {
  beforeEach(() => {
    query.mockReset();
    ensureDatabaseSchema.mockClear();
    getDbPoolMock.mockReset();
    getDbPoolMock.mockReturnValue({
      query,
    });
  });

  it("creates a session for the current user", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "session-1",
          user_id: "user-1",
          title: "新对话",
          summary: "",
          created_at: new Date("2026-04-12T00:00:00.000Z"),
          updated_at: new Date("2026-04-12T00:00:00.000Z"),
          last_message_at: null,
        },
      ],
    });

    const result = await createSession({
      userId: "user-1",
      sessionId: "session-1",
    });

    expect(ensureDatabaseSchema).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      id: "session-1",
      userId: "user-1",
      title: "新对话",
      summary: "",
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:00:00.000Z",
      lastMessageAt: null,
    });
  });

  it("lists sessions by user in recent-first order", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "session-2",
          user_id: "user-1",
          title: "第二个会话",
          summary: "",
          created_at: new Date("2026-04-12T00:00:00.000Z"),
          updated_at: new Date("2026-04-12T01:00:00.000Z"),
          last_message_at: new Date("2026-04-12T01:00:00.000Z"),
        },
      ],
    });

    const result = await listSessionsByUser({
      userId: "user-1",
      limit: 10,
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual(["user-1", 10]);
    expect(result[0]?.id).toBe("session-2");
  });

  it("returns null when a session cannot be found for the current user", async () => {
    query.mockResolvedValueOnce({
      rows: [],
    });

    await expect(
      getSessionById({
        sessionId: "missing-session",
        userId: "user-2",
      }),
    ).resolves.toBeNull();
  });

  it("appends messages with a monotonically increasing sequence number", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "message-1",
          session_id: "session-1",
          role: "user",
          content: "hello",
          metadata: {},
          sequence_no: 3,
          created_at: new Date("2026-04-12T00:00:01.000Z"),
        },
      ],
    });

    const result = await appendMessage({
      sessionId: "session-1",
      userId: "user-1",
      messageId: "message-1",
      role: "user",
      content: "hello",
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]?.[0]).toBe("session-1");
    expect(query.mock.calls[0]?.[1]?.[1]).toBe("user-1");
    expect(result).toEqual({
      id: "message-1",
      sessionId: "session-1",
      role: "user",
      content: "hello",
      metadata: {},
      sequenceNo: 3,
      createdAt: "2026-04-12T00:00:01.000Z",
    });
  });

  it("lists messages in sequence order for the owning user only", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "message-1",
          session_id: "session-1",
          role: "user",
          content: "hello",
          metadata: {},
          sequence_no: 1,
          created_at: new Date("2026-04-12T00:00:01.000Z"),
        },
        {
          id: "message-2",
          session_id: "session-1",
          role: "assistant",
          content: "world",
          metadata: { runId: "run-1" },
          sequence_no: 2,
          created_at: new Date("2026-04-12T00:00:02.000Z"),
        },
      ],
    });

    const result = await listMessagesBySession({
      sessionId: "session-1",
      userId: "user-1",
    });

    expect(query.mock.calls[0]?.[1]).toEqual(["session-1", "user-1"]);
    expect(result.map((message) => message.sequenceNo)).toEqual([1, 2]);
  });

  it("updates the session title", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "session-1",
          user_id: "user-1",
          title: "新的标题",
          summary: "",
          created_at: new Date("2026-04-12T00:00:00.000Z"),
          updated_at: new Date("2026-04-12T00:00:03.000Z"),
          last_message_at: new Date("2026-04-12T00:00:03.000Z"),
        },
      ],
    });

    const result = await updateSessionTitle({
      sessionId: "session-1",
      userId: "user-1",
      title: "新的标题",
    });

    expect(result?.title).toBe("新的标题");
  });

  it("throws a clear error when the database is unavailable", async () => {
    getDbPoolMock.mockReturnValueOnce(null);

    await expect(
      listSessionsByUser({
        userId: "user-1",
      }),
    ).rejects.toThrow("DATABASE_URL is not configured on the server.");
  });
});
