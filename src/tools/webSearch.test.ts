import { afterEach, describe, expect, it, vi } from "vitest";

const originalTavilyApiKey = process.env.TAVILY_API_KEY;
const originalTavilyApiBaseUrl = process.env.TAVILY_API_BASE_URL;
const originalWebSearchContentMaxChars = process.env.WEB_SEARCH_CONTENT_MAX_CHARS;

describe("webSearch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    process.env.TAVILY_API_KEY = originalTavilyApiKey;
    process.env.TAVILY_API_BASE_URL = originalTavilyApiBaseUrl;
    process.env.WEB_SEARCH_CONTENT_MAX_CHARS = originalWebSearchContentMaxChars;
  });

  it("returns compact Tavily results", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    process.env.WEB_SEARCH_CONTENT_MAX_CHARS = "20";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                title: "Example title",
                url: "https://example.com/article",
                content: "This is a long snippet that should be clipped.",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const { webSearch } = await import("./webSearch");
    const result = await webSearch("latest example");

    expect(result.status).toBe("success");
    expect(result.provider).toBe("tavily");
    expect(result.results).toEqual([
      {
        title: "Example title",
        url: "https://example.com/article",
        content: "This is a long sn...",
      },
    ]);
  });

  it("returns an explicit empty result when Tavily has no hits", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const { webSearch } = await import("./webSearch");
    const result = await webSearch("query with no results");

    expect(result).toEqual({
      status: "empty",
      provider: "tavily",
      results: [],
    });
  });

  it("throws a recognizable error when Tavily fails", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad gateway", { status: 502 })),
    );

    const { webSearch, WebSearchError } = await import("./webSearch");

    await expect(webSearch("latest example")).rejects.toBeInstanceOf(WebSearchError);
  });
});
