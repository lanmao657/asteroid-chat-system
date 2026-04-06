import { afterEach, describe, expect, it, vi } from "vitest";

const originalProviders = process.env.SEARCH_PROVIDERS;
const originalSearchApiKey = process.env.SEARCH_API_KEY;
const originalBlockedDomains = process.env.SEARCH_BLOCKED_DOMAINS;
const originalDemotedDomains = process.env.SEARCH_DEMOTED_DOMAINS;
const originalJinaApiKey = process.env.JINA_API_KEY;
const originalTavilyApiKey = process.env.TAVILY_API_KEY;

describe("searchWeb, knowledgeBaseSearch, fetchWebPage, and weatherLookup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    process.env.SEARCH_PROVIDERS = originalProviders;
    process.env.SEARCH_API_KEY = originalSearchApiKey;
    process.env.SEARCH_BLOCKED_DOMAINS = originalBlockedDomains;
    process.env.SEARCH_DEMOTED_DOMAINS = originalDemotedDomains;
    process.env.JINA_API_KEY = originalJinaApiKey;
    process.env.TAVILY_API_KEY = originalTavilyApiKey;
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
          return new Response("<html></html>", { status: 200 });
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
    const result = await searchWeb({ query: "AI agent 最新新闻 2026" });

    expect(result.provider).toBe("bing-rss");
    expect(result.results).toHaveLength(1);
    expect(result.results[0].domain).toBe("reuters.com");
  });

  it("fetches page text into a compact excerpt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          "<html><head><title>Hello</title><meta name='description' content='Desc'></head><body><main>Body content for testing</main></body></html>",
          { status: 200, headers: { "Content-Type": "text/html" } },
        ),
      ),
    );

    const { fetchWebPage } = await import("./tools");
    const page = await fetchWebPage({ url: "https://example.com/article" });

    expect(page.title).toBe("Hello");
    expect(page.description).toBe("Desc");
    expect(page.excerpt).toContain("Body content for testing");
  });

  it("returns hybrid knowledge base candidates", async () => {
    process.env.JINA_API_KEY = "";
    const { searchKnowledgeBase } = await import("./tools");
    const result = await searchKnowledgeBase({
      query: "knowledge base observability and rerank",
    });

    expect(result.provider).toBe("knowledge-base");
    expect(result.documents.length).toBeGreaterThan(0);
    expect(result.strategy === "hybrid" || result.strategy === "dense-only").toBe(true);
  });

  it("parses weather API responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            current_condition: [
              {
                temp_C: "24",
                FeelsLikeC: "26",
                humidity: "72",
                windspeedKmph: "13",
                weatherDesc: [{ value: "Sunny" }],
              },
            ],
            nearest_area: [{ areaName: [{ value: "Shanghai" }] }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const { lookupWeather } = await import("./tools");
    const weather = await lookupWeather({ location: "Shanghai" });

    expect(weather.location).toBe("Shanghai");
    expect(weather.summary).toBe("Sunny");
    expect(weather.temperatureC).toBe(24);
  });

  it("drops low-quality bing news fallback results instead of returning forum/tutorial pages", async () => {
    process.env.SEARCH_PROVIDERS = "bing-rss";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `<?xml version="1.0"?><rss><channel>
            <item><title>in/over recent years - WordReference Forums</title><link>https://forum.wordreference.com/threads/example</link><description>recent thread</description></item>
            <item><title>Win10最近使用文件记录怎样删除？</title><link>https://jingyan.baidu.com/article/example.html</link><description>操作经验</description></item>
          </channel></rss>`,
          {
            status: 200,
            headers: { "Content-Type": "application/rss+xml" },
          },
        ),
      ),
    );

    const { searchWeb } = await import("./tools");
    const result = await searchWeb({ query: "recent news about AI agents" });

    expect(result.provider).toBe("bing-rss");
    expect(result.results).toEqual([]);
  });

  it("retries alternate news queries within the same provider before giving up", async () => {
    process.env.SEARCH_PROVIDERS = "bing-rss";

    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const query = decodeURIComponent(url.match(/[?&]q=([^&]+)/)?.[1] ?? "");

      if (query === "AI news last week") {
        return new Response(
          `<?xml version="1.0"?><rss><channel>
            <item><title>AI forum discussion</title><link>https://forum.example.com/thread</link><description>community thread</description></item>
          </channel></rss>`,
          { status: 200, headers: { "Content-Type": "application/rss+xml" } },
        );
      }

      if (query === "artificial intelligence major news past 7 days") {
        return new Response(
          `<?xml version="1.0"?><rss><channel>
            <item><title>Reuters AI roundup</title><link>https://www.reuters.com/technology/ai-roundup</link><description>Major AI news this week</description></item>
          </channel></rss>`,
          { status: 200, headers: { "Content-Type": "application/rss+xml" } },
        );
      }

      return new Response("<rss><channel></channel></rss>", {
        status: 200,
        headers: { "Content-Type": "application/rss+xml" },
      });
    });

    vi.stubGlobal("fetch", fetchSpy);

    const { searchWeb } = await import("./tools");
    const result = await searchWeb({
      query:
        "\u5e2e\u6211\u67e5\u4e00\u4e0b\u6700\u8fd1\u4e00\u5468 AI \u9886\u57df\u6709\u54ea\u4e9b\u91cd\u8981\u65b0\u95fb\uff0c\u5217\u51fa\u6807\u9898\u3001\u53d1\u5e03\u65f6\u95f4\u548c\u5a92\u4f53\u6765\u6e90",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.provider).toBe("bing-rss");
    expect(result.queryUsed).toBe("artificial intelligence major news past 7 days");
    expect(result.results).toHaveLength(1);
    expect(result.attempts?.map((attempt) => attempt.status)).toEqual(["empty", "success"]);
  });

  it("prioritizes an English query for recent OpenAI news", async () => {
    process.env.SEARCH_PROVIDERS = "bing-rss";

    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const query = decodeURIComponent(url.match(/[?&]q=([^&]+)/)?.[1] ?? "");

      if (query === "OpenAI news last week") {
        return new Response(
          `<?xml version="1.0"?><rss><channel>
            <item><title>OpenAI ships new model</title><link>https://www.reuters.com/technology/openai-model</link><description>OpenAI news this week</description></item>
          </channel></rss>`,
          { status: 200, headers: { "Content-Type": "application/rss+xml" } },
        );
      }

      throw new Error(`Unexpected query: ${query}`);
    });

    vi.stubGlobal("fetch", fetchSpy);

    const { searchWeb } = await import("./tools");
    const result = await searchWeb({
      query: "\u6700\u8fd1 OpenAI \u6709\u4ec0\u4e48\u65b0\u95fb",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.queryUsed).toBe("OpenAI news last week");
    expect(result.results[0]?.domain).toBe("reuters.com");
  });

  it("keeps ordinary web queries on the original query without news rewrites", async () => {
    process.env.SEARCH_PROVIDERS = "bing-rss";

    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const query = decodeURIComponent(url.match(/[?&]q=([^&]+)/)?.[1] ?? "");

      expect(query).toBe("OpenAI API official docs");

      return new Response(
        `<?xml version="1.0"?><rss><channel>
          <item><title>OpenAI API docs</title><link>https://platform.openai.com/docs</link><description>Official documentation</description></item>
        </channel></rss>`,
        { status: 200, headers: { "Content-Type": "application/rss+xml" } },
      );
    });

    vi.stubGlobal("fetch", fetchSpy);

    const { searchWeb } = await import("./tools");
    const result = await searchWeb({ query: "OpenAI API official docs" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.queryUsed).toBe("OpenAI API official docs");
    expect(result.results).toHaveLength(1);
  });
});
