import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const originalProviders = process.env.SEARCH_PROVIDERS;
const originalSearchApiKey = process.env.SEARCH_API_KEY;
const originalBlockedDomains = process.env.SEARCH_BLOCKED_DOMAINS;
const originalDemotedDomains = process.env.SEARCH_DEMOTED_DOMAINS;
const originalJinaApiKey = process.env.JINA_API_KEY;
const originalTavilyApiKey = process.env.TAVILY_API_KEY;
const originalKnowledgeBaseMinScore = process.env.KNOWLEDGE_BASE_MIN_SCORE;
const originalKnowledgeBaseEnableRerank = process.env.KNOWLEDGE_BASE_ENABLE_RERANK;

describe("searchWeb, knowledgeBaseSearch, fetchWebPage, and weatherLookup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.doUnmock("@/lib/db/knowledge-repository");
    process.env.SEARCH_PROVIDERS = originalProviders;
    process.env.SEARCH_API_KEY = originalSearchApiKey;
    process.env.SEARCH_BLOCKED_DOMAINS = originalBlockedDomains;
    process.env.SEARCH_DEMOTED_DOMAINS = originalDemotedDomains;
    process.env.JINA_API_KEY = originalJinaApiKey;
    process.env.TAVILY_API_KEY = originalTavilyApiKey;
    process.env.KNOWLEDGE_BASE_MIN_SCORE = originalKnowledgeBaseMinScore;
    process.env.KNOWLEDGE_BASE_ENABLE_RERANK = originalKnowledgeBaseEnableRerank;
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
    const result = await searchWeb({ query: "AI agent latest news 2026" });

    expect(result.provider).toBe("bing-rss");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.domain).toBe("reuters.com");
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

  it("returns knowledge base chunk candidates from the repository", async () => {
    process.env.JINA_API_KEY = "";
    vi.doMock("@/lib/db/knowledge-repository", () => ({
      searchKnowledgeChunksByUser: vi.fn(async () => [
        {
          documentId: "doc-1",
          documentTitle: "退款处理 SOP",
          chunkId: "chunk-1",
          chunkIndex: 0,
          content: "先确认订单状态，再同步到账时效。",
          score: 0.86,
          sourceType: "knowledge_base",
          snippet: "先确认订单状态，再同步到账时效。",
        },
      ]),
    }));

    const { searchKnowledgeBase } = await import("./tools");
    const result = await searchKnowledgeBase({
      userId: "user-1",
      query: "退款处理 到账时效",
    });

    expect(result.provider).toBe("knowledge-base");
    expect(result.documents).toHaveLength(1);
    expect(result.strategy).toBe("fts");
    expect(result.documents[0]?.metadata).toEqual(
      expect.objectContaining({
        documentId: "doc-1",
        chunkId: "chunk-1",
        chunkIndex: 0,
        sourceType: "knowledge_base",
      }),
    );
  });

  it("skips rerank cleanly when rerank is disabled", async () => {
    process.env.KNOWLEDGE_BASE_ENABLE_RERANK = "false";
    vi.doMock("@/lib/db/knowledge-repository", () => ({
      searchKnowledgeChunksByUser: vi.fn(async () => [
        {
          documentId: "doc-1",
          documentTitle: "退款处理 SOP",
          chunkId: "chunk-1",
          chunkIndex: 0,
          content: "先确认订单状态，再同步到账时效。",
          score: 0.86,
          sourceType: "knowledge_base",
          snippet: "先确认订单状态，再同步到账时效。",
        },
      ]),
    }));

    const { searchKnowledgeBase } = await import("./tools");
    const result = await searchKnowledgeBase({
      userId: "user-1",
      query: "退款处理 到账时效",
    });

    expect(result.reranked).toBe(false);
    expect(result.rerankSkippedReason).toBe("rerank_disabled");
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
            "遇到退款争议时先确认订单状态、支付记录和退款规则，再向客户复述已核实的事实，并同步预计到账时间。",
          metadata: {
            documentId: "doc-1",
            chunkId: "chunk-1",
            chunkIndex: 0,
            documentTitle: "客服退款争议处理 SOP",
            sourceType: "knowledge_base",
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
    expect(assessment.coverageRatio).toBeGreaterThan(0.3);
    expect(assessment.relevantDocumentCount).toBe(1);
  });

  it("assesses weak fuzzy matches as rewrite", async () => {
    const { assessKnowledgeBaseRetrieval } = await import("./tools");
    const assessment = assessKnowledgeBaseRetrieval({
      query: "客户因为退款到账慢而投诉时，客服应该怎么回复？请结合客服退款争议处理 SOP 给出标准说法。",
      documents: [
        {
          id: "weak",
          title: "工作记录",
          source: "internal-doc",
          content: "这里有一些泛化说明，但没有标准退款争议处理条目的信息。",
          scores: { final: 0.64 },
        },
      ],
    });

    expect(assessment.decision).toBe("rewrite");
    expect(assessment.reason).toContain("title/tag alignment");
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
