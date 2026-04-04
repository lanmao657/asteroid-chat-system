import { afterEach, describe, expect, it, vi } from "vitest";

import type { LLMProvider, SearchResult } from "./types";

const snippetOnlyResult: SearchResult = {
  title: "AI Agent latest roundup",
  url: "https://www.reuters.com/tech/ai-agent",
  snippet: "Latest AI agent news snippet",
  domain: "reuters.com",
  evidence: "search-snippet",
  fetchStatus: "skipped",
  skipReason: "blocked-domain",
  rankingSignals: ["trusted-news-domain"],
};

describe("provider fallback behavior", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    delete process.env.MODEL_PROVIDER;
    delete process.env.OPENAI_COMPAT_API_KEY;
    delete process.env.OPENAI_MODEL;
  });

  it("keeps answering with a background summary when search fails", async () => {
    process.env.MODEL_PROVIDER = "mock";
    const { createProvider } = await import("./provider");
    const provider = createProvider() as LLMProvider;

    const reply = await provider.composeAnswer({
      userMessage: "帮我查一下最近关于 AI agent 的新闻，并整理成一段适合产品演示的中文摘要。",
      conversation: [],
      searchResults: [],
      pageContents: [],
      fallbackMode: "background",
      toolResults: [
        {
          callId: "1",
          tool: "searchWeb",
          status: "error",
          summary: "搜索工具请求失败了，请稍后重试。",
          payload: [],
          provider: "duckduckgo-html",
          errorType: "network",
          userMessage: "搜索工具请求失败了，请稍后重试。系统将继续提供一版背景回答。",
          detail: "fetch failed",
          recoverable: true,
          degradationMode: "background",
        },
      ],
    });

    expect(reply).toContain("实时检索");
    expect(reply).toContain("背景回答");
    expect(reply).toContain("AI agent");
  });

  it("states when the answer is based only on search snippets", async () => {
    process.env.MODEL_PROVIDER = "mock";
    const { createProvider } = await import("./provider");
    const provider = createProvider() as LLMProvider;

    const reply = await provider.composeAnswer({
      userMessage: "AI agent 最新新闻",
      conversation: [],
      searchResults: [snippetOnlyResult],
      pageContents: [],
      fallbackMode: "snippet-only",
      toolResults: [
        {
          callId: "1",
          tool: "searchWeb",
          status: "success",
          summary: "保留 1 条高相关结果，过滤 2 条明确受限来源。",
          payload: [snippetOnlyResult],
          provider: "bing-rss",
          userMessage: "已切换备用搜索源并完成筛选。",
          filteredCount: 2,
          degradationMode: "snippet-only",
        },
      ],
    });

    expect(reply).toContain("主要依据搜索摘要");
    expect(reply).toContain("正文抓取");
  });

  it("falls back to a local rate-limit reply when model generation is throttled", async () => {
    process.env.MODEL_PROVIDER = "openai";
    process.env.OPENAI_COMPAT_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "test-model";

    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));

    const { createProvider } = await import("./provider");
    const provider = createProvider() as LLMProvider;
    const reply = await provider.composeAnswer({
      userMessage: "AI agent 最新新闻",
      conversation: [],
      searchResults: [snippetOnlyResult],
      pageContents: [],
      fallbackMode: "snippet-only",
      toolResults: [
        {
          callId: "1",
          tool: "searchWeb",
          status: "success",
          summary: "保留 1 条高相关结果，过滤 2 条明确受限来源。",
          payload: [snippetOnlyResult],
          provider: "bing-rss",
          userMessage: "已切换备用搜索源并完成筛选。",
          filteredCount: 2,
          degradationMode: "snippet-only",
        },
      ],
    });

    expect(reply).toContain("限流");
    expect(reply).toContain("本地降级");
  });
});
