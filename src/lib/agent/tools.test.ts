import { afterEach, describe, expect, it, vi } from "vitest";

const originalProviders = process.env.SEARCH_PROVIDERS;
const originalSearchApiKey = process.env.SEARCH_API_KEY;
const originalBlockedDomains = process.env.SEARCH_BLOCKED_DOMAINS;
const originalDemotedDomains = process.env.SEARCH_DEMOTED_DOMAINS;
const originalJinaApiKey = process.env.JINA_API_KEY;

describe("searchWeb, knowledgeBaseSearch, fetchWebPage, and weatherLookup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    process.env.SEARCH_PROVIDERS = originalProviders;
    process.env.SEARCH_API_KEY = originalSearchApiKey;
    process.env.SEARCH_BLOCKED_DOMAINS = originalBlockedDomains;
    process.env.SEARCH_DEMOTED_DOMAINS = originalDemotedDomains;
    process.env.JINA_API_KEY = originalJinaApiKey;
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
});
