import { afterEach, describe, expect, it, vi } from "vitest";

import { runAgentTurn } from "./runtime";
import { SearchToolError } from "./tools";
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
  decideWebSearchToolCall: vi.fn(async ({ userMessage }) => ({
    status: /latest|recent|today|current|news/i.test(userMessage)
      ? ("call" as const)
      : ("none" as const),
    reason: "decided",
    query: userMessage,
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
      userMessage: "search the knowledge base for agent workspace design docs",
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
      decideWebSearchToolCall: vi.fn(async () => ({
        status: "none" as const,
        reason: "not needed",
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
      decideWebSearchToolCall: vi.fn(async () => ({
        status: "none" as const,
        reason: "not needed",
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
      decideWebSearchToolCall: vi.fn(async () => ({
        status: "none" as const,
        reason: "not needed",
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
      decideWebSearchToolCall: vi.fn(async () => ({
        status: "none" as const,
        reason: "not needed",
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

  it("uses model-requested web_search results without breaking tool events", async () => {
    const provider = createProvider();
    const search = vi.fn(async () => ({
      provider: "tavily" as const,
      queryUsed: "AI news last week",
      rawCount: 3,
      normalizedCount: 2,
      filterReasons: { duplicate: 1 },
      attempts: [
        {
          provider: "tavily" as const,
          query: "AI news last week",
          status: "success" as const,
          rawCount: 3,
          normalizedCount: 2,
          keptCount: 1,
          filteredCount: 1,
          filterReasons: { duplicate: 1 },
        },
      ],
      results: [
        {
          title: "Latest AI Agent News",
          url: "https://www.reuters.com/technology/ai-agent-news",
          snippet: "fresh result",
          domain: "www.reuters.com",
          evidence: "search-snippet" as const,
          fetchStatus: "pending" as const,
          rankingSignals: ["trusted-domain", "news-keyword"],
          score: 12,
        },
      ],
      filteredResults: [],
    }));
    const fetchPage = vi.fn(async () => ({
      title: "Latest AI Agent News",
      url: "https://www.reuters.com/technology/ai-agent-news",
      description: "desc",
      excerpt: "full page excerpt",
    }));
    const { events, emit } = collectEvents();

    const result = await runAgentTurn({
      sessionId: "session-7",
      userMessage: "latest AI agent news",
      conversation: [],
      memorySummary: "",
      emit,
      dependencies: {
        provider,
        search,
        fetchPage,
      },
    });

    expect(result.status).toBe("completed");
    expect(provider.decideWebSearchToolCall).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === "tool_started")).toBe(true);
    expect(events.some((event) => event.type === "tool_result")).toBe(true);
    const toolResultEvent = events.find(
      (event) => event.type === "tool_result" && event.toolResult.tool === "searchWeb",
    );
    expect(toolResultEvent && toolResultEvent.type === "tool_result").toBe(true);
    if (toolResultEvent?.type === "tool_result") {
      const detail = JSON.parse(toolResultEvent.toolResult.detail ?? "{}") as Record<string, unknown>;
      expect(detail.queryUsed).toBe("AI news last week");
      expect(detail.providerUsed).toBe("tavily");
      expect(detail.rawCount).toBe(3);
      expect(detail.normalizedCount).toBe(2);
      expect(detail.filterReasons).toEqual({ duplicate: 1 });
    }
  });

  it("treats low-quality web results as empty and skips page fetches", async () => {
    const provider = createProvider();
    const search = vi.fn(async () => ({
      provider: "bing-rss" as const,
      results: [
        {
          title: "Forum thread",
          url: "https://forum.example.com/thread",
          snippet: "recent discussion",
          domain: "forum.example.com",
          evidence: "search-snippet" as const,
          fetchStatus: "pending" as const,
          rankingSignals: ["community-pattern"],
          score: 1,
        },
      ],
      filteredResults: [],
    }));
    const fetchPage = vi.fn();
    const { events, emit } = collectEvents();

    const result = await runAgentTurn({
      sessionId: "session-8",
      userMessage: "latest AI agent news",
      conversation: [],
      memorySummary: "",
      emit,
      dependencies: {
        provider,
        search,
        fetchPage,
      },
    });

    expect(result.status).toBe("completed");
    expect(fetchPage).not.toHaveBeenCalled();
    expect(
      events.some(
        (event) =>
          event.type === "tool_result" &&
          event.toolResult.tool === "searchWeb" &&
          event.toolResult.status === "empty",
      ),
    ).toBe(true);
  });

  it("completes without an error event when provider returns a fallback answer", async () => {
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
      decideWebSearchToolCall: vi.fn(async () => ({
        status: "call" as const,
        query: "latest ai agent news",
        reason: "requested",
      })),
      streamAnswer: vi.fn(async ({ onDelta }) => {
        await onDelta("fallback answer from provider");
        return {
          text: "fallback answer from provider",
          finishReason: "error" as const,
        };
      }),
    };
    const search = vi.fn(async () => ({
      provider: "tavily" as const,
      results: [],
      filteredResults: [],
    }));
    const { events, emit } = collectEvents();

    const result = await runAgentTurn({
      sessionId: "session-9",
      userMessage: "latest AI agent news",
      conversation: [],
      memorySummary: "",
      emit,
      dependencies: { provider, search },
    });

    expect(result.status).toBe("completed");
    expect(result.assistantText).toBe("fallback answer from provider");
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("extracts the weather location from Chinese queries before calling the weather tool", async () => {
    const provider = createProvider();
    const weatherLookup = vi.fn(async ({ location }: { location: string }) => ({
      location,
      summary: "Light rain",
      temperatureC: 29,
      feelsLikeC: 33,
      humidity: 82,
      windKph: 12,
    }));
    const { events, emit } = collectEvents();

    const result = await runAgentTurn({
      sessionId: "session-10",
      userMessage: "帮我查一下新加坡今天的天气，并给出穿衣和出行建议。",
      conversation: [],
      memorySummary: "",
      emit,
      dependencies: {
        provider,
        weatherLookup,
      },
    });

    expect(result.status).toBe("completed");
    expect(weatherLookup).toHaveBeenCalledWith(
      expect.objectContaining({ location: "新加坡" }),
    );
    expect(
      events.some(
        (event) =>
          event.type === "tool_result" &&
          event.toolResult.tool === "weatherLookup" &&
          event.toolResult.status === "success",
      ),
    ).toBe(true);
  });

  it("reports weather lookup failures as weather tool errors instead of web search failures", async () => {
    const provider = createProvider();
    const weatherLookup = vi.fn(async () => {
      throw new SearchToolError(
        "Weather lookup failed with status 500.",
        "http",
        "weather-api",
        "HTTP 500",
      );
    });
    const { events, emit } = collectEvents();

    const result = await runAgentTurn({
      sessionId: "session-11",
      userMessage: "帮我查一下新加坡今天的天气",
      conversation: [],
      memorySummary: "",
      emit,
      dependencies: {
        provider,
        weatherLookup,
      },
    });

    expect(result.status).toBe("completed");
    const toolResultEvent = events.find(
      (event) =>
        event.type === "tool_result" &&
        event.toolResult.status === "error",
    );

    expect(toolResultEvent?.type).toBe("tool_result");
    if (toolResultEvent?.type === "tool_result") {
      expect(toolResultEvent.toolResult.tool).toBe("weatherLookup");
      expect(toolResultEvent.toolResult.phase).toBe("weather");
      expect(toolResultEvent.toolResult.summary).toBe(
        "Weather lookup failed, so this turn falls back to a direct answer.",
      );
      expect(toolResultEvent.toolResult.provider).toBe("weather-api");
      expect(toolResultEvent.toolResult.errorType).toBe("http");
      expect(toolResultEvent.toolResult.detail).toBe("HTTP 500");
    }
  });
});
