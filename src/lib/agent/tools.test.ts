import { afterEach, describe, expect, it, vi } from "vitest";

const originalProviders = process.env.SEARCH_PROVIDERS;
const originalSearchApiKey = process.env.SEARCH_API_KEY;
const originalBlockedDomains = process.env.SEARCH_BLOCKED_DOMAINS;
const originalDemotedDomains = process.env.SEARCH_DEMOTED_DOMAINS;

describe("searchWeb", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    process.env.SEARCH_PROVIDERS = originalProviders;
    process.env.SEARCH_API_KEY = originalSearchApiKey;
    process.env.SEARCH_BLOCKED_DOMAINS = originalBlockedDomains;
    process.env.SEARCH_DEMOTED_DOMAINS = originalDemotedDomains;
  });

  it("falls back to bing rss when primary providers fail", async () => {
    process.env.SEARCH_API_KEY = "test-key";
    process.env.SEARCH_PROVIDERS = "search-api,duckduckgo-html,bing-rss";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes("google.serper.dev")) {
          return new Response("bad gateway", { status: 502 });
        }

        if (url.includes("html.duckduckgo.com")) {
          throw new Error("fetch failed");
        }

        return new Response(
          `<?xml version="1.0"?><rss><channel><item><title>Reuters AI Agent News</title><link>https://www.reuters.com/tech/ai-agent</link><description>Latest AI agent news snippet</description></item></channel></rss>`,
          {
            status: 200,
            headers: { "Content-Type": "application/rss+xml" },
          },
        );
      }),
    );

    const { searchWeb } = await import("./tools");
    const result = await searchWeb("AI agent 最新新闻 2026");

    expect(result.provider).toBe("bing-rss");
    expect(result.results).toHaveLength(1);
    expect(result.results[0].domain).toBe("reuters.com");
    expect(result.attempts.some((attempt) => attempt.provider === "search-api")).toBe(true);
    expect(result.attempts.some((attempt) => attempt.provider === "bing-rss" && attempt.ok)).toBe(
      true,
    );
  });

  it("uses the primary search api when configured", async () => {
    process.env.SEARCH_API_KEY = "test-key";
    process.env.SEARCH_PROVIDERS = "search-api,duckduckgo-html,bing-rss";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (!url.includes("google.serper.dev")) {
          throw new Error("unexpected fallback request");
        }

        expect(init?.method).toBe("POST");
        return new Response(
          JSON.stringify({
            organic: [
              {
                title: "Reuters AI Agent News",
                link: "https://www.reuters.com/tech/ai-agent",
                snippet: "Latest AI agent news snippet",
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }),
    );

    const { searchWeb } = await import("./tools");
    const result = await searchWeb("AI agent 最新新闻");

    expect(result.provider).toBe("search-api");
    expect(result.results[0].domain).toBe("reuters.com");
    expect(result.attempts).toEqual([{ provider: "search-api", ok: true }]);
  });

  it("demotes low-value domains instead of blocking them by default", async () => {
    process.env.SEARCH_API_KEY = "test-key";
    process.env.SEARCH_DEMOTED_DOMAINS = "zhihu.com";
    process.env.SEARCH_BLOCKED_DOMAINS = "";
    process.env.SEARCH_PROVIDERS = "search-api";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            organic: [
              {
                title: "知乎上的 AI agent 讨论",
                link: "https://www.zhihu.com/question/123",
                snippet: "社区问答摘要",
              },
              {
                title: "Reuters AI Agent News",
                link: "https://www.reuters.com/tech/ai-agent",
                snippet: "Latest AI agent news snippet",
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    const { searchWeb } = await import("./tools");
    const result = await searchWeb("AI agent 最新新闻");

    expect(result.results[0].domain).toBe("reuters.com");
    expect(result.results.some((entry) => entry.domain === "zhihu.com")).toBe(true);
    expect(result.filteredResults).toHaveLength(0);
  });

  it("throws a structured empty-result error when every result is explicitly blocked", async () => {
    process.env.SEARCH_API_KEY = "test-key";
    process.env.SEARCH_BLOCKED_DOMAINS = "zhihu.com";
    process.env.SEARCH_PROVIDERS = "search-api";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            organic: [
              {
                title: "知乎上的 AI agent 讨论",
                link: "https://www.zhihu.com/question/123",
                snippet: "社区问答摘要",
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    const { SearchToolError, searchWeb } = await import("./tools");
    await expect(searchWeb("AI agent 最新新闻")).rejects.toBeInstanceOf(SearchToolError);
  });
});
