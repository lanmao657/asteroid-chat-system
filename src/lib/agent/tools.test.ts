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
      query: "报销制度和审批流程",
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

  it("keeps trusted results for broad daily news roundup queries instead of filtering them all out", async () => {
    process.env.SEARCH_PROVIDERS = "bing-rss";

    const fetchSpy = vi.fn(async () =>
      new Response(
        `<?xml version="1.0"?><rss><channel>
          <item><title>Reuters World News</title><link>https://www.reuters.com/world/example</link><description>Top news today from Reuters</description></item>
          <item><title>AP Top Headlines</title><link>https://apnews.com/article/example</link><description>Today's major headlines</description></item>
        </channel></rss>`,
        {
          status: 200,
          headers: { "Content-Type": "application/rss+xml" },
        },
      ),
    );

    vi.stubGlobal("fetch", fetchSpy);

    const { searchWeb } = await import("./tools");
    const result = await searchWeb({
      query: "2024年今天重要新闻 国内国际要闻 晨会摘要",
    });

    expect(result.provider).toBe("bing-rss");
    expect(result.queryUsed).toBeTruthy();
    expect(result.results).toHaveLength(2);
    expect(result.results.map((item) => item.domain)).toEqual([
      "reuters.com",
      "apnews.com",
    ]);
  });

  it("preserves an explicit historical year when latest-news queries include a real topic", async () => {
    process.env.SEARCH_PROVIDERS = "bing-rss";

    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const query = decodeURIComponent(url.match(/[?&]q=([^&]+)/)?.[1] ?? "");

      expect(query).toBe("2024年 OpenAI 最新新闻");

      return new Response(
        `<?xml version="1.0"?><rss><channel>
          <item><title>OpenAI in 2024</title><link>https://www.reuters.com/technology/openai-2024</link><description>OpenAI developments in 2024</description></item>
        </channel></rss>`,
        {
          status: 200,
          headers: { "Content-Type": "application/rss+xml" },
        },
      );
    });

    vi.stubGlobal("fetch", fetchSpy);

    const { searchWeb } = await import("./tools");
    const result = await searchWeb({ query: "2024年 OpenAI 最新新闻" });

    expect(
      fetchSpy.mock.calls.some(([input]) =>
        decodeURIComponent(String(input).match(/[?&]q=([^&]+)/)?.[1] ?? "") ===
        "2024年 OpenAI 最新新闻",
      ),
    ).toBe(true);
    expect(result.queryUsed).toBe("2024年 OpenAI 最新新闻");
    expect(result.results).toHaveLength(1);
  });

  it("assesses a strong matching sop plus unrelated docs as answer", async () => {
    const { assessKnowledgeBaseRetrieval } = await import("./tools");
    const assessment = assessKnowledgeBaseRetrieval({
      query: "客户因为退款到账慢而投诉时，客服应该怎么回复？请结合客服退款争议处理 SOP 给出标准说法。",
      documents: [
        {
          id: "refund-sop",
          title: "客服退款争议处理 SOP",
          source: "internal-doc",
          url: "kb://enterprise/sop/customer-service-refund-dispute",
          content:
            "遇到退款争议时先确认订单状态、支付记录和退款规则，再向客户复述已核实的事实。可退场景应在 2 小时内发起退款申请，并同步预计到账时间。",
          metadata: {
            tags: ["客服", "退款", "SOP", "话术", "投诉"],
          },
          scores: { final: 0.92 },
        },
        {
          id: "expense",
          title: "员工费用报销制度",
          source: "internal-doc",
          content: "报销、审批、财务流程",
          scores: { final: 0.31 },
        },
      ],
    });

    expect(assessment.decision).toBe("answer");
    expect(assessment.decisionSource).toBe("retrieval-heuristic");
    expect(assessment.coverageRatio).toBeGreaterThan(0.3);
    expect(assessment.relevantDocumentCount).toBe(1);
    expect(assessment.topDocument?.title).toBe("客服退款争议处理 SOP");
  });

  it("assesses weak fuzzy matches as rewrite", async () => {
    const { assessKnowledgeBaseRetrieval } = await import("./tools");
    const assessment = assessKnowledgeBaseRetrieval({
      query: "客户因为退款到账慢而投诉时，客服应该怎么回复？请结合客服退款争议处理 SOP 给出标准说法。",
      documents: [
        {
          id: "weak",
          title: "通用客服记录",
          source: "internal-doc",
          content: "这里有一些模糊相似但没有退款争议处理条目的内容。",
          scores: { final: 0.64 },
        },
      ],
    });

    expect(assessment.decision).toBe("rewrite");
    expect(assessment.coverageRatio).toBeLessThan(0.4);
    expect(assessment.reason).toContain("no title/tag alignment");
  });

  it("assesses a top document without title tag alignment as rewrite", async () => {
    const { assessKnowledgeBaseRetrieval } = await import("./tools");
    const assessment = assessKnowledgeBaseRetrieval({
      query: "请总结新版产品卖点与销售话术指引",
      documents: [
        {
          id: "content-only",
          title: "销售培训记录",
          source: "internal-doc",
          content: "这里提到了产品卖点和销售话术，但标题和标签没有直接对应。",
          metadata: {
            tags: ["培训"],
          },
          scores: { final: 0.77 },
        },
      ],
    });

    expect(assessment.decision).toBe("rewrite");
    expect(assessment.topDocument?.titleTagHits).toEqual([]);
    expect(assessment.reason).toContain("title/tag alignment");
  });
});
