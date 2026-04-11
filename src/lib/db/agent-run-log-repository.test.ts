import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, ensureDatabaseSchema } = vi.hoisted(() => ({
  query: vi.fn(),
  ensureDatabaseSchema: vi.fn(async () => true),
}));

vi.mock("./client", () => ({
  getDbPool: () => ({
    query,
  }),
}));

vi.mock("./schema", () => ({
  AGENT_RUN_LOGS_TABLE: "agent_run_logs",
  ensureDatabaseSchema,
}));

import { insertAgentRunLog, listAgentRunLogs } from "./agent-run-log-repository";

describe("agent-run-log-repository", () => {
  beforeEach(() => {
    query.mockReset();
    ensureDatabaseSchema.mockClear();
  });

  it("writes run logs with jsonb tool results", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await insertAgentRunLog({
      runId: "11111111-1111-4111-8111-111111111111",
      sessionId: "session-1",
      taskCategory: "policy_qa",
      provider: "OpenAI Compatible",
      status: "completed",
      userMessage: "hello",
      assistantMessage: "world",
      memorySummary: "",
      toolResults: [],
      startedAt: "2026-04-06T00:00:00.000Z",
      finishedAt: "2026-04-06T00:00:01.000Z",
    });

    expect(ensureDatabaseSchema).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]?.[0]).toBe("11111111-1111-4111-8111-111111111111");
    expect(query.mock.calls[0]?.[1]?.[2]).toBe("policy_qa");
    expect(query.mock.calls[0]?.[1]?.[8]).toBe("[]");
  });

  it("lists latest run logs in finished time order", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          run_id: "11111111-1111-4111-8111-111111111111",
          session_id: "session-1",
          task_category: "sop_lookup",
          provider: "OpenAI Compatible",
          status: "completed",
          user_message: "hello",
          assistant_message: "world",
          memory_summary: "",
          tool_results: [],
          error_message: null,
          started_at: new Date("2026-04-06T00:00:00.000Z"),
          finished_at: new Date("2026-04-06T00:00:01.000Z"),
          created_at: new Date("2026-04-06T00:00:01.000Z"),
        },
      ],
    });

    const result = await listAgentRunLogs({
      sessionId: "session-1",
      limit: 5,
    });

    expect(ensureDatabaseSchema).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        id: 1,
        runId: "11111111-1111-4111-8111-111111111111",
        sessionId: "session-1",
        taskCategory: "sop_lookup",
        provider: "OpenAI Compatible",
        status: "completed",
        userMessage: "hello",
        assistantMessage: "world",
        memorySummary: "",
        toolResults: [],
        errorMessage: null,
        startedAt: "2026-04-06T00:00:00.000Z",
        finishedAt: "2026-04-06T00:00:01.000Z",
        createdAt: "2026-04-06T00:00:01.000Z",
      },
    ]);
  });
});
