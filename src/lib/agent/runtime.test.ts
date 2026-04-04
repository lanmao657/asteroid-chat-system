import { describe, expect, it } from "vitest";

import { runAgentTurn } from "./runtime";
import { SearchToolError } from "./tools";
import type { AgentStreamEvent, LLMProvider, SearchResult } from "./types";

const collectEvents = () => {
  const events: AgentStreamEvent[] = [];
  return {
    events,
    emit: (event: AgentStreamEvent) => {
      events.push(event);
    },
  };
};

const rankedSearchResult: SearchResult = {
  title: "Reuters AI Agent News",
  url: "https://www.reuters.com/tech/ai-agent",
  snippet: "Latest AI agent news snippet",
  domain: "reuters.com",
  evidence: "search-snippet",
  fetchStatus: "pending",
  rankingSignals: ["trusted-news-domain"],
};

describe("runAgentTurn", () => {
  it("responds directly when the provider skips tools", async () => {
    const provider: LLMProvider = {
      id: "test-direct",
      label: "Test Direct",
      async decideNextAction() {
        return { mode: "respond", rationale: "No tool required." };
      },
      async composeAnswer() {
        return "Direct answer";
      },
    };

    const { events, emit } = collectEvents();
    const result = await runAgentTurn({
      sessionId: "session-1",
      userMessage: "hello",
      conversation: [],
      emit,
      dependencies: { provider },
    });

    expect(result.assistantText).toBe("Direct answer");
    expect(events.some((event) => event.type === "tool_started")).toBe(false);
  });

  it("executes search and page fetch when the provider requests web tools", async () => {
    const provider: LLMProvider = {
      id: "test-search",
      label: "Test Search",
      async decideNextAction() {
        return {
          mode: "search",
          rationale: "Need fresh info.",
          query: "latest ai agent news",
        };
      },
      async composeAnswer(input) {
        return `Sources: ${input.pageContents.length} / tools: ${input.toolResults.length} / fallback:${input.fallbackMode}`;
      },
    };

    const { events, emit } = collectEvents();
    const result = await runAgentTurn({
      sessionId: "session-2",
      userMessage: "latest ai agent news",
      conversation: [],
      emit,
      dependencies: {
        provider,
        search: async () => ({
          provider: "search-api",
          results: [rankedSearchResult],
          filteredResults: [],
          attempts: [{ provider: "search-api", ok: true }],
        }),
        fetchPage: async (url) => ({
          title: "Fetched",
          url,
          description: "Description",
          excerpt: "Excerpt",
        }),
      },
    });

    expect(result.searchResults).toHaveLength(1);
    expect(result.pageContents).toHaveLength(1);
    expect(result.assistantText).toContain("Sources: 1");
    expect(result.assistantText).toContain("fallback:none");
    expect(events.some((event) => event.type === "assistant_delta")).toBe(true);
  });

  it("continues to compose an answer when search fails", async () => {
    const provider: LLMProvider = {
      id: "test-failure",
      label: "Test Failure",
      async decideNextAction() {
        return {
          mode: "search",
          rationale: "Need fresh info.",
          query: "today headlines",
        };
      },
      async composeAnswer(input) {
        return `继续回答:${input.fallbackMode}`;
      },
    };

    const { events, emit } = collectEvents();
    const result = await runAgentTurn({
      sessionId: "session-3",
      userMessage: "today headlines",
      conversation: [],
      emit,
      dependencies: {
        provider,
        search: async () => {
          throw new SearchToolError(
            "Search request failed for duckduckgo-html.",
            "network",
            "duckduckgo-html",
            "搜索工具请求失败了，请稍后重试。",
            "fetch failed",
          );
        },
      },
    });

    expect(result.searchResults).toHaveLength(0);
    expect(result.assistantText).toContain("继续回答:background");
    expect(events.some((event) => event.type === "tool_result")).toBe(true);
    expect(events.some((event) => event.type === "assistant_started")).toBe(true);
    expect(events.some((event) => event.type === "assistant_delta")).toBe(true);
  });

  it("does not fetch blocked or skipped results", async () => {
    const provider: LLMProvider = {
      id: "test-skipped",
      label: "Test Skipped",
      async decideNextAction() {
        return {
          mode: "search",
          rationale: "Need fresh info.",
          query: "AI agent 最新新闻",
        };
      },
      async composeAnswer(input) {
        const skipped = input.toolResults.filter((entry) => entry.status === "skipped");
        return `skipped:${skipped.length} mode:${input.fallbackMode}`;
      },
    };

    let fetchCount = 0;

    const { events, emit } = collectEvents();
    const result = await runAgentTurn({
      sessionId: "session-4",
      userMessage: "AI agent 最新新闻",
      conversation: [],
      emit,
      dependencies: {
        provider,
        search: async () => ({
          provider: "bing-rss",
          results: [
            {
              ...rankedSearchResult,
              domain: "restricted.example.com",
              fetchStatus: "skipped",
              skipReason: "blocked-domain",
            },
          ],
          filteredResults: [],
          attempts: [{ provider: "bing-rss", ok: true }],
        }),
        fetchPage: async (url) => {
          fetchCount += 1;
          return {
            title: "Fetched",
            url,
            description: "Description",
            excerpt: "Excerpt",
          };
        },
      },
    });

    expect(fetchCount).toBe(0);
    expect(result.assistantText).toContain("skipped:1");
    expect(result.assistantText).toContain("mode:snippet-only");
    expect(
      events.some(
        (event) => event.type === "tool_started" && event.toolCall.tool === "fetchWebPage",
      ),
    ).toBe(false);
  });
});
