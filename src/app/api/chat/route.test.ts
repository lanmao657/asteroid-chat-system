import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentStreamEvent } from "@/lib/agent/types";

const {
  appendMessageMock,
  createSessionMock,
  getSessionByIdMock,
  insertAgentRunLogMock,
  isDatabaseConfiguredMock,
  listMessagesBySessionMock,
  requireApiSessionMock,
  runAgentTurnMock,
  touchSessionLastMessageAtMock,
  updateSessionSummaryMock,
  updateSessionTitleMock,
} = vi.hoisted(() => ({
  appendMessageMock: vi.fn(),
  createSessionMock: vi.fn(),
  getSessionByIdMock: vi.fn(),
  insertAgentRunLogMock: vi.fn(async () => true),
  isDatabaseConfiguredMock: vi.fn(),
  listMessagesBySessionMock: vi.fn(),
  requireApiSessionMock: vi.fn(),
  runAgentTurnMock: vi.fn(),
  touchSessionLastMessageAtMock: vi.fn(async () => true),
  updateSessionSummaryMock: vi.fn(),
  updateSessionTitleMock: vi.fn(),
}));

vi.mock("@/lib/agent/runtime", () => ({
  runAgentTurn: runAgentTurnMock,
}));

vi.mock("@/lib/auth/session", () => ({
  requireApiSession: requireApiSessionMock,
}));

vi.mock("@/lib/db/agent-run-log-repository", () => ({
  insertAgentRunLog: insertAgentRunLogMock,
}));

vi.mock("@/lib/db/chat-session-repository", () => ({
  appendMessage: appendMessageMock,
  createSession: createSessionMock,
  getSessionById: getSessionByIdMock,
  listMessagesBySession: listMessagesBySessionMock,
  touchSessionLastMessageAt: touchSessionLastMessageAtMock,
  updateSessionSummary: updateSessionSummaryMock,
  updateSessionTitle: updateSessionTitleMock,
}));

vi.mock("@/lib/db/env", () => ({
  DATABASE_NOT_CONFIGURED_MESSAGE: "DATABASE_URL is not configured on the server.",
  isDatabaseConfigured: isDatabaseConfiguredMock,
}));

import { POST } from "./route";

const readSseEvents = async (response: Response) => {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  const events: AgentStreamEvent[] = [];
  let buffer = "";

  if (!reader) {
    return events;
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) {
        continue;
      }

      events.push(JSON.parse(dataLine.slice(6)) as AgentStreamEvent);
    }
  }

  return events;
};

describe("POST /api/chat", () => {
  beforeEach(() => {
    appendMessageMock.mockReset();
    createSessionMock.mockReset();
    getSessionByIdMock.mockReset();
    insertAgentRunLogMock.mockClear();
    isDatabaseConfiguredMock.mockReset();
    listMessagesBySessionMock.mockReset();
    requireApiSessionMock.mockReset();
    runAgentTurnMock.mockReset();
    touchSessionLastMessageAtMock.mockClear();
    updateSessionSummaryMock.mockReset();
    updateSessionTitleMock.mockReset();

    requireApiSessionMock.mockResolvedValue({
      response: null,
      session: {
        user: {
          id: "user-1",
          email: "user@example.com",
          name: "Lan Mao",
        },
      },
    });
    isDatabaseConfiguredMock.mockReturnValue(true);
    updateSessionSummaryMock.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      title: "新对话",
      summary: "updated summary",
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:00:03.000Z",
      lastMessageAt: "2026-04-12T00:00:03.000Z",
    });
    updateSessionTitleMock.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      title: "First prompt",
      summary: "",
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:00:01.000Z",
      lastMessageAt: "2026-04-12T00:00:01.000Z",
    });
    runAgentTurnMock.mockImplementation(async ({ emit, sessionId }) => {
      emit({ type: "run_started", runId: "run-1", sessionId });
      emit({ type: "session", sessionId, provider: "Mock Provider" });
      emit({ type: "assistant_started" });
      emit({ type: "assistant_delta", delta: "hello " });

      return {
        sessionId,
        runId: "run-1",
        userMessage: "First prompt",
        conversation: [],
        recentConversation: [],
        memorySummary: "updated summary",
        toolResults: [],
        taskCategory: "general",
        status: "completed",
        assistantText: "hello world",
        citations: [],
      };
    });
  });

  it("creates a new session when sessionId is missing", async () => {
    createSessionMock.mockResolvedValueOnce({
      id: "generated-session",
      userId: "user-1",
      title: "新对话",
      summary: "",
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:00:00.000Z",
      lastMessageAt: null,
    });
    appendMessageMock
      .mockResolvedValueOnce({
        id: "message-user-1",
        sessionId: "generated-session",
        role: "user",
        content: "First prompt",
        metadata: {},
        sequenceNo: 1,
        createdAt: "2026-04-12T00:00:01.000Z",
      })
      .mockResolvedValueOnce({
        id: "message-assistant-1",
        sessionId: "generated-session",
        role: "assistant",
        content: "hello world",
        metadata: { runId: "run-1" },
        sequenceNo: 2,
        createdAt: "2026-04-12T00:00:02.000Z",
      });
    listMessagesBySessionMock.mockResolvedValueOnce([
      {
        id: "message-user-1",
        sessionId: "generated-session",
        role: "user",
        content: "First prompt",
        metadata: {},
        sequenceNo: 1,
        createdAt: "2026-04-12T00:00:01.000Z",
      },
    ]);

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          message: "First prompt",
        }),
      }),
    );
    const events = await readSseEvents(response);

    expect(response.status).toBe(200);
    expect(createSessionMock).toHaveBeenCalledWith({
      userId: "user-1",
    });
    expect(runAgentTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeUserId: "user-1",
      }),
    );
    expect(events.map((event) => event.type)).toContain("assistant_final");
  });

  it("persists the assistant message before emitting assistant_final", async () => {
    let assistantPersisted = false;

    getSessionByIdMock.mockResolvedValueOnce({
      id: "session-1",
      userId: "user-1",
      title: "新对话",
      summary: "",
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:00:00.000Z",
      lastMessageAt: null,
    });
    appendMessageMock
      .mockResolvedValueOnce({
        id: "message-user-1",
        sessionId: "session-1",
        role: "user",
        content: "First prompt",
        metadata: {},
        sequenceNo: 1,
        createdAt: "2026-04-12T00:00:01.000Z",
      })
      .mockImplementationOnce(async () => {
        assistantPersisted = true;
        return {
          id: "message-assistant-1",
          sessionId: "session-1",
          role: "assistant",
          content: "hello world",
          metadata: { runId: "run-1" },
          sequenceNo: 2,
          createdAt: "2026-04-12T00:00:02.000Z",
        };
      });
    listMessagesBySessionMock.mockResolvedValueOnce([
      {
        id: "message-user-1",
        sessionId: "session-1",
        role: "user",
        content: "First prompt",
        metadata: {},
        sequenceNo: 1,
        createdAt: "2026-04-12T00:00:01.000Z",
      },
    ]);

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "session-1",
          message: "First prompt",
        }),
      }),
    );
    const events = await readSseEvents(response);
    const assistantFinalEvent = events.find(
      (event): event is Extract<AgentStreamEvent, { type: "assistant_final" }> =>
        event.type === "assistant_final",
    );

    expect(assistantFinalEvent?.message.id).toBe("message-assistant-1");
    expect(assistantPersisted).toBe(true);
    expect(insertAgentRunLogMock).toHaveBeenCalledTimes(1);
  });

  it("returns persisted assistant citations in assistant_final metadata", async () => {
    runAgentTurnMock.mockImplementationOnce(async ({ emit, sessionId }) => {
      emit({ type: "run_started", runId: "run-2", sessionId });
      emit({ type: "session", sessionId, provider: "Mock Provider" });

      return {
        sessionId,
        runId: "run-2",
        userMessage: "退款处理 到账时效",
        conversation: [],
        recentConversation: [],
        memorySummary: "updated summary",
        toolResults: [],
        taskCategory: "policy_qa",
        status: "completed",
        assistantText: "请先确认订单状态，再同步到账时效。",
        citations: [
          {
            citationId: "doc-1:chunk-1",
            sourceType: "knowledge_base",
            documentId: "doc-1",
            documentTitle: "退款处理 SOP",
            chunkId: "chunk-1",
            chunkIndex: 0,
            snippet: "先确认订单状态，再同步到账时效。",
            score: 0.91,
          },
        ],
      };
    });
    getSessionByIdMock.mockResolvedValueOnce({
      id: "session-1",
      userId: "user-1",
      title: "新对话",
      summary: "",
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:00:00.000Z",
      lastMessageAt: null,
    });
    appendMessageMock
      .mockResolvedValueOnce({
        id: "message-user-1",
        sessionId: "session-1",
        role: "user",
        content: "退款处理 到账时效",
        metadata: {},
        sequenceNo: 1,
        createdAt: "2026-04-12T00:00:01.000Z",
      })
      .mockResolvedValueOnce({
        id: "message-assistant-2",
        sessionId: "session-1",
        role: "assistant",
        content: "请先确认订单状态，再同步到账时效。",
        metadata: {
          runId: "run-2",
          citations: [
            {
              citationId: "doc-1:chunk-1",
              sourceType: "knowledge_base",
              documentId: "doc-1",
              documentTitle: "退款处理 SOP",
              chunkId: "chunk-1",
              chunkIndex: 0,
              snippet: "先确认订单状态，再同步到账时效。",
              score: 0.91,
            },
          ],
        },
        sequenceNo: 2,
        createdAt: "2026-04-12T00:00:02.000Z",
      });
    listMessagesBySessionMock.mockResolvedValueOnce([
      {
        id: "message-user-1",
        sessionId: "session-1",
        role: "user",
        content: "退款处理 到账时效",
        metadata: {},
        sequenceNo: 1,
        createdAt: "2026-04-12T00:00:01.000Z",
      },
    ]);

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "session-1",
          message: "退款处理 到账时效",
        }),
      }),
    );
    const events = await readSseEvents(response);
    const assistantFinalEvent = events.find(
      (event): event is Extract<AgentStreamEvent, { type: "assistant_final" }> =>
        event.type === "assistant_final",
    );

    expect(assistantFinalEvent?.message.metadata).toEqual(
      expect.objectContaining({
        citations: [
          expect.objectContaining({
            documentTitle: "退款处理 SOP",
            chunkId: "chunk-1",
          }),
        ],
      }),
    );
  });

  it("returns 503 when chat persistence is unavailable", async () => {
    isDatabaseConfiguredMock.mockReturnValueOnce(false);

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "session-1",
          message: "hello",
        }),
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "DATABASE_URL is not configured on the server.",
    });
  });
});
