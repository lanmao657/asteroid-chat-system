import { afterEach, describe, expect, it, vi } from "vitest";

import { runAgentTurn } from "./runtime";
import type { AgentStreamEvent, LLMProvider, RetrievalDocument } from "./types";

const collectEvents = () => {
  const events: AgentStreamEvent[] = [];
  return {
    events,
    emit: (event: AgentStreamEvent) => {
      events.push(event);
    },
  };
};

const createRetrievalDocument = (final = 0.72): RetrievalDocument => ({
  id: "doc-1",
  title: "Doc 1",
  source: "knowledge-base",
  content: "retrieval content",
  scores: { final },
});

const createProvider = (): LLMProvider => ({
  id: "test-provider",
  label: "Test Provider",
  summarizeConversation: vi.fn(async ({ messagesToSummarize }) => {
    return `summary:${messagesToSummarize.length}`;
  }),
  rewriteQuery: vi.fn(async ({ strategyHint, userMessage }) => ({
    mode: strategyHint ?? "step-back",
    query: `${userMessage} rewritten`,
    reason: "rewrite requested",
  })),
  gradeDocuments: vi.fn(async ({ retrievalContext }) => ({
    decision:
      retrievalContext.length > 0 && retrievalContext[0].scores.final > 0.55
        ? ("answer" as const)
        : ("rewrite" as const),
    averageScore: retrievalContext.length > 0 ? retrievalContext[0].scores.final : 0,
    reason: "graded",
  })),
  streamAnswer: vi.fn(async ({ onDelta }) => {
    await onDelta("hello ");
    await onDelta("world");
    return {
      text: "hello world",
      finishReason: "stop" as const,
    };
  }),
});

describe("runAgentTurn", () => {
  afterEach(() => {
    delete process.env.AGENT_MAX_CONTINUATIONS;
    delete process.env.AGENT_CONTINUATION_TAIL_CHARS;
    vi.resetModules();
  });

  it("compacts old messages and streams the assistant answer", async () => {
    const provider = createProvider();
    const { events, emit } = collectEvents();

    const result = await runAgentTurn({
      sessionId: "session-1",
      userMessage: "continue",
      conversation: Array.from({ length: 9 }, (_, index) => ({
        id: `m${index + 1}`,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `message-${index + 1}`,
        createdAt: new Date().toISOString(),
      })),
      memorySummary: "",
      emit,
      dependencies: {
        provider,
      },
    });

    expect(result.status).toBe("completed");
    expect(result.memorySummary).toBe("summary:5");
    expect(provider.summarizeConversation).toHaveBeenCalledTimes(1);
    expect(provider.streamAnswer).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "session",
      "memory_compacted",
      "tool_started",
      "tool_progress",
      "assistant_started",
      "assistant_delta",
      "assistant_delta",
    ]);
  });

  it("runs observable knowledge-base retrieval with grading", async () => {
    const provider = createProvider();
    const searchKnowledgeBase = vi.fn(async ({ onProgress }) => {
      onProgress?.({
        callId: "",
        tool: "knowledgeBaseSearch",
        message: "hybrid search",
      });
      return {
        provider: "knowledge-base" as const,
        strategy: "hybrid" as const,
        reranked: false,
        documents: [createRetrievalDocument()],
      };
    });
    const { events, emit } = collectEvents();

    const result = await runAgentTurn({
      sessionId: "session-2",
      userMessage: "请从知识库里找一下 agent workspace 的设计说明",
      conversation: [],
      memorySummary: "",
      emit,
      dependencies: {
        provider,
        searchKnowledgeBase,
      },
    });

    expect(result.status).toBe("completed");
    expect(searchKnowledgeBase).toHaveBeenCalledTimes(1);
    expect(provider.gradeDocuments).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toContain("tool_started");
    expect(events.map((event) => event.type)).toContain("tool_progress");
    expect(events.map((event) => event.type)).toContain("tool_result");
  });

  it("returns aborted state when the signal aborts during generation", async () => {
    const controller = new AbortController();
    const provider: LLMProvider = {
      id: "test-provider",
      label: "Test Provider",
      summarizeConversation: vi.fn(async () => ""),
      rewriteQuery: vi.fn(async () => ({
        mode: "step-back" as const,
        query: "rewritten",
        reason: "reason",
      })),
      gradeDocuments: vi.fn(async () => ({
        decision: "answer" as const,
        averageScore: 0.8,
        reason: "good enough",
      })),
      streamAnswer: vi.fn(async ({ onDelta, signal }) => {
        await onDelta("partial");
        controller.abort();
        signal?.throwIfAborted?.();
        return {
          text: "partial",
          finishReason: "abort" as const,
        };
      }),
    };
    const { events, emit } = collectEvents();

    const result = await runAgentTurn({
      sessionId: "session-3",
      userMessage: "hello",
      conversation: [],
      memorySummary: "",
      emit,
      signal: controller.signal,
      dependencies: { provider },
    });

    expect(result.status).toBe("aborted");
    expect(result.assistantText).toBe("partial");
    expect(events.some((event) => event.type === "assistant_aborted")).toBe(true);
  });

  it("keeps the streamed delta aggregation even if the provider returns a shorter final string", async () => {
    const provider: LLMProvider = {
      id: "test-provider",
      label: "Test Provider",
      summarizeConversation: vi.fn(async () => ""),
      rewriteQuery: vi.fn(async () => ({
        mode: "step-back" as const,
        query: "rewritten",
        reason: "reason",
      })),
      gradeDocuments: vi.fn(async () => ({
        decision: "answer" as const,
        averageScore: 0.9,
        reason: "good enough",
      })),
      streamAnswer: vi.fn(async ({ onDelta }) => {
        await onDelta("this is a much longer streamed answer");
        return {
          text: "short",
          finishReason: "stop" as const,
        };
      }),
    };

    const result = await runAgentTurn({
      sessionId: "session-4",
      userMessage: "hello",
      conversation: [],
      memorySummary: "",
      emit: () => {},
      dependencies: { provider },
    });

    expect(result.status).toBe("completed");
    expect(result.assistantText).toBe("this is a much longer streamed answer");
  });

  it("continues generation when the first pass ends because of the output limit", async () => {
    const provider: LLMProvider = {
      id: "test-provider",
      label: "Test Provider",
      summarizeConversation: vi.fn(async () => ""),
      rewriteQuery: vi.fn(async () => ({
        mode: "step-back" as const,
        query: "rewritten",
        reason: "reason",
      })),
      gradeDocuments: vi.fn(async () => ({
        decision: "answer" as const,
        averageScore: 0.9,
        reason: "good enough",
      })),
      streamAnswer: vi
        .fn()
        .mockImplementationOnce(async ({ onDelta }) => {
          await onDelta("Step 1\n");
          return {
            text: "Step 1",
            finishReason: "length" as const,
          };
        })
        .mockImplementationOnce(async ({ onDelta, userMessage }) => {
          expect(userMessage).toContain("Continuation 2");
          expect(userMessage).toContain("Step 1");
          await onDelta("Step 2");
          return {
            text: "Step 2",
            finishReason: "stop" as const,
          };
        }),
    };
    const { events, emit } = collectEvents();

    const result = await runAgentTurn({
      sessionId: "session-5",
      userMessage: "give me a long outline",
      conversation: [],
      memorySummary: "",
      emit,
      dependencies: { provider },
    });

    expect(result.status).toBe("completed");
    expect(result.assistantText).toBe("Step 1\nStep 2");
    expect(provider.streamAnswer).toHaveBeenCalledTimes(2);
    expect(
      events.some(
        (event) =>
          event.type === "tool_progress" &&
          event.progress.message.includes("Continuing answer"),
      ),
    ).toBe(true);
  });

  it("stops continuing after the configured continuation cap", async () => {
    process.env.AGENT_MAX_CONTINUATIONS = "1";
    vi.resetModules();

    const { runAgentTurn: runAgentTurnWithEnv } = await import("./runtime");
    const provider: LLMProvider = {
      id: "test-provider",
      label: "Test Provider",
      summarizeConversation: vi.fn(async () => ""),
      rewriteQuery: vi.fn(async () => ({
        mode: "step-back" as const,
        query: "rewritten",
        reason: "reason",
      })),
      gradeDocuments: vi.fn(async () => ({
        decision: "answer" as const,
        averageScore: 0.9,
        reason: "good enough",
      })),
      streamAnswer: vi.fn(async ({ onDelta }) => {
        await onDelta("more ");
        return {
          text: "more ",
          finishReason: "length" as const,
        };
      }),
    };
    const { events, emit } = collectEvents();

    const result = await runAgentTurnWithEnv({
      sessionId: "session-6",
      userMessage: "give me a very long outline",
      conversation: [],
      memorySummary: "",
      emit,
      dependencies: { provider },
    });

    expect(result.status).toBe("completed");
    expect(provider.streamAnswer).toHaveBeenCalledTimes(2);
    expect(result.assistantText).toBe("more more ");
    expect(
      events.some(
        (event) =>
          event.type === "tool_progress" &&
          event.progress.message === "Continuing -> limit reached",
      ),
    ).toBe(true);
  });
});
