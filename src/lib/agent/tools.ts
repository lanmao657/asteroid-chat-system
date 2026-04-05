import * as cheerio from "cheerio";

import { agentEnv } from "@/lib/agent/env";
import { knowledgeBaseDocuments } from "@/lib/agent/knowledge-base";
import type {
  FetchedPage,
  RetrievalDocument,
  SearchProviderName,
  SearchResult,
  ToolErrorType,
  ToolProgress,
  WeatherResult,
} from "@/lib/agent/types";

export class SearchToolError extends Error {
  constructor(
    message: string,
    public readonly type: ToolErrorType,
    public readonly provider: SearchProviderName,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "SearchToolError";
  }
}

export interface SearchResponse {
  provider: SearchProviderName;
  results: SearchResult[];
  filteredResults: SearchResult[];
}

export interface KnowledgeBaseSearchResponse {
  provider: "knowledge-base";
  documents: RetrievalDocument[];
  strategy: "hybrid" | "dense-only";
  reranked: boolean;
}

const SEARCH_PROVIDER_ORDER: SearchProviderName[] = [
  "search-api",
  "duckduckgo-html",
  "bing-rss",
];

const BLOCKED_DOMAINS = agentEnv.searchBlockedDomains.map((item) => item.toLowerCase());
const DEMOTED_DOMAINS = agentEnv.searchDemotedDomains.map((item) => item.toLowerCase());
const NEWS_KEYWORDS = [
  "最新",
  "最近",
  "今天",
  "今日",
  "新闻",
  "实时",
  "搜一下",
  "查一下",
  "latest",
  "recent",
  "today",
  "current",
  "news",
  "search",
  "web",
];
const TRUSTED_NEWS_DOMAINS = [
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "bbc.co.uk",
  "theverge.com",
  "techcrunch.com",
  "wired.com",
  "36kr.com",
  "ithome.com",
  "caixin.com",
];

const normalizeWhitespace = (value: string) =>
  value.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();

const isAbortError = (error: unknown) =>
  error instanceof Error &&
  (error.name === "AbortError" || error.message.toLowerCase().includes("abort"));

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw new SearchToolError("Request aborted.", "aborted", "search-api");
  }
};

const withTimeout = async <T>(
  factory: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  upstreamSignal?: AbortSignal,
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
  const abortFromUpstream = () => controller.abort("upstream-abort");

  upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });

  try {
    return await factory(controller.signal);
  } catch (error) {
    if (controller.signal.aborted && upstreamSignal?.aborted) {
      throw new SearchToolError("Request aborted.", "aborted", "search-api");
    }
    if (controller.signal.aborted) {
      throw new SearchToolError(
        `Timed out after ${timeoutMs}ms.`,
        "timeout",
        "search-api",
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
};

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const extractDomain = (rawUrl: string) => {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

const tokenize = (value: string) =>
  normalizeWhitespace(value)
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .filter(Boolean);

const buildCharGrams = (value: string, size = 2) => {
  const compact = normalizeWhitespace(value).toLowerCase().replace(/\s+/g, "");
  const grams: string[] = [];

  for (let index = 0; index <= compact.length - size; index += 1) {
    grams.push(compact.slice(index, index + size));
  }

  return grams.length > 0 ? grams : compact ? [compact] : [];
};

const cosineFromCounters = (left: Map<string, number>, right: Map<string, number>) => {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (const [token, leftValue] of left.entries()) {
    const rightValue = right.get(token) ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
  }

  for (const rightValue of right.values()) {
    rightNorm += rightValue * rightValue;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
};

const buildCounter = (tokens: string[]) => {
  const counter = new Map<string, number>();
  for (const token of tokens) {
    counter.set(token, (counter.get(token) ?? 0) + 1);
  }
  return counter;
};

const reciprocalRankFusion = (...ranks: number[]) =>
  ranks.reduce((total, rank) => total + 1 / (60 + rank), 0);

const matchesDomainList = (domain: string, list: string[]) =>
  list.some((item) => domain === item || domain.endsWith(`.${item}`));

const isNewsLikeQuery = (query: string) => {
  const normalized = query.toLowerCase();
  return NEWS_KEYWORDS.some((keyword) => normalized.includes(keyword));
};

const rankSearchResult = (result: SearchResult, isNewsQuery: boolean) => {
  let score = 0;
  const haystack = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
  const signals: string[] = [];

  if (isNewsQuery && NEWS_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    score += 8;
    signals.push("news-keyword");
  }

  if (matchesDomainList(result.domain, TRUSTED_NEWS_DOMAINS)) {
    score += 10;
    signals.push("trusted-domain");
  }

  if (matchesDomainList(result.domain, DEMOTED_DOMAINS)) {
    score -= 8;
    signals.push("demoted-domain");
  }

  if (/question|answer|问答|贴吧|community|forum/.test(haystack)) {
    score -= 6;
    signals.push("community-pattern");
  }

  result.rankingSignals = signals;
  result.score = score;
  return score;
};

const createSearchResult = (title: string, url: string, snippet: string): SearchResult => ({
  title,
  url,
  snippet,
  domain: extractDomain(url),
  evidence: "search-snippet",
  fetchStatus: "pending",
  rankingSignals: [],
});

const filterAndRankResults = (query: string, rawResults: SearchResult[]) => {
  const filteredResults: SearchResult[] = [];
  const ranked = rawResults
    .map((result) => {
      const blocked = matchesDomainList(result.domain, BLOCKED_DOMAINS);
      if (blocked) {
        filteredResults.push({
          ...result,
          fetchStatus: "skipped",
          skipReason: "blocked-domain",
          rankingSignals: ["blocked-domain"],
        });
        return null;
      }

      const score = rankSearchResult(result, isNewsLikeQuery(query));
      return { result, score };
    })
    .filter((entry): entry is { result: SearchResult; score: number } => Boolean(entry))
    .sort((left, right) => right.score - left.score)
    .slice(0, agentEnv.searchMaxResults)
    .map((entry) => entry.result);

  return { results: ranked, filteredResults };
};

const decodeDuckDuckGoUrl = (href: string) => {
  if (href.startsWith("//")) {
    return `https:${href}`;
  }

  if (href.startsWith("/")) {
    const url = new URL(`https://duckduckgo.com${href}`);
    const redirected = url.searchParams.get("uddg");
    return redirected ? safeDecode(redirected) : url.toString();
  }

  return href;
};

const decodeXmlEntities = (value: string) =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const fetchText = async (
  url: string,
  provider: SearchProviderName,
  signal?: AbortSignal,
  init?: RequestInit,
) => {
  const response = await withTimeout(
    (innerSignal) =>
      fetch(url, {
        ...init,
        headers: {
          "User-Agent": "Mozilla/5.0 Agent Workspace",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
          ...(init?.headers ?? {}),
        },
        signal: innerSignal,
      }),
    agentEnv.webFetchTimeoutMs,
    signal,
  );

  if (!response.ok) {
    throw new SearchToolError(
      `Search failed with status ${response.status}.`,
      "http",
      provider,
      `HTTP ${response.status}`,
    );
  }

  return response.text();
};

const searchWithSearchApi = async (query: string, signal?: AbortSignal) => {
  if (!agentEnv.searchApiKey) {
    throw new SearchToolError("Search API key missing.", "unknown", "search-api");
  }

  const response = await withTimeout(
    (innerSignal) =>
      fetch(agentEnv.searchApiBaseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": agentEnv.searchApiKey,
        },
        body: JSON.stringify({
          q: query,
          num: Math.max(agentEnv.searchMaxResults * 2, 10),
        }),
        signal: innerSignal,
      }),
    agentEnv.webFetchTimeoutMs,
    signal,
  );

  if (!response.ok) {
    throw new SearchToolError(
      `Search API failed with status ${response.status}.`,
      "http",
      "search-api",
      `HTTP ${response.status}`,
    );
  }

  const payload = (await response.json()) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
  };

  const rawResults = (payload.organic ?? [])
    .map((item) => {
      const title = normalizeWhitespace(item.title ?? "");
      const url = normalizeWhitespace(item.link ?? "");
      const snippet = normalizeWhitespace(item.snippet ?? "");
      return title && url ? createSearchResult(title, url, snippet) : null;
    })
    .filter((entry): entry is SearchResult => Boolean(entry));

  if (!rawResults.length) {
    throw new SearchToolError("Search API returned no results.", "empty", "search-api");
  }

  return filterAndRankResults(query, rawResults);
};

const searchWithDuckDuckGo = async (query: string, signal?: AbortSignal) => {
  const html = await fetchText(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    "duckduckgo-html",
    signal,
  );

  const $ = cheerio.load(html);
  const rawResults: SearchResult[] = [];

  $(".result").each((_, element) => {
    if (rawResults.length >= agentEnv.searchMaxResults * 2) {
      return false;
    }

    const titleNode = $(element).find(".result__title a").first();
    const title = normalizeWhitespace(titleNode.text());
    const url = decodeDuckDuckGoUrl(titleNode.attr("href") ?? "");
    const snippet = normalizeWhitespace($(element).find(".result__snippet").first().text());

    if (title && url) {
      rawResults.push(createSearchResult(title, url, snippet));
    }

    return undefined;
  });

  if (!rawResults.length) {
    throw new SearchToolError("DuckDuckGo returned no results.", "empty", "duckduckgo-html");
  }

  return filterAndRankResults(query, rawResults);
};

const searchWithBingRss = async (query: string, signal?: AbortSignal) => {
  const xml = await fetchText(
    `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`,
    "bing-rss",
    signal,
  );

  const rawResults = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .slice(0, agentEnv.searchMaxResults * 2)
    .map((match) => {
      const block = match[1];
      const title = normalizeWhitespace(
        decodeXmlEntities(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ""),
      );
      const url = normalizeWhitespace(
        decodeXmlEntities(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? ""),
      );
      const snippet = normalizeWhitespace(
        decodeXmlEntities(block.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? ""),
      );
      return title && url ? createSearchResult(title, url, snippet) : null;
    })
    .filter((entry): entry is SearchResult => Boolean(entry));

  if (!rawResults.length) {
    throw new SearchToolError("Bing RSS returned no results.", "empty", "bing-rss");
  }

  return filterAndRankResults(query, rawResults);
};

const runSearchProvider = async (
  provider: SearchProviderName,
  query: string,
  signal?: AbortSignal,
) => {
  if (provider === "search-api") {
    return searchWithSearchApi(query, signal);
  }
  if (provider === "duckduckgo-html") {
    return searchWithDuckDuckGo(query, signal);
  }
  return searchWithBingRss(query, signal);
};

export const searchWeb = async ({
  query,
  signal,
  onProgress,
}: {
  query: string;
  signal?: AbortSignal;
  onProgress?: (progress: ToolProgress) => void;
}): Promise<SearchResponse> => {
  throwIfAborted(signal);

  const providers = Array.from(
    new Set(
      agentEnv.searchProviders.filter((value): value is SearchProviderName =>
        SEARCH_PROVIDER_ORDER.includes(value as SearchProviderName),
      ),
    ),
  );

  const orderedProviders = providers.length > 0 ? providers : SEARCH_PROVIDER_ORDER;
  let lastError: SearchToolError | null = null;

  for (const [index, provider] of orderedProviders.entries()) {
    throwIfAborted(signal);
    onProgress?.({
      callId: "",
      tool: "searchWeb",
      message:
        index === 0
          ? `正在尝试 ${provider} 搜索源`
          : `主搜索未命中，切换到 ${provider}`,
      provider,
      step: index + 1,
      totalSteps: orderedProviders.length,
    });

    try {
      const result = await runSearchProvider(provider, query, signal);
      return { provider, ...result };
    } catch (error) {
      if (error instanceof SearchToolError) {
        if (error.type === "aborted") {
          throw error;
        }
        lastError = error;
        continue;
      }

      if (isAbortError(error)) {
        throw new SearchToolError("Request aborted.", "aborted", provider);
      }

      lastError = new SearchToolError(
        "Search request failed.",
        "unknown",
        provider,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  throw (
    lastError ??
    new SearchToolError("Search request failed.", "unknown", orderedProviders[0] ?? "search-api")
  );
};

export const fetchWebPage = async ({
  url,
  signal,
}: {
  url: string;
  signal?: AbortSignal;
}): Promise<FetchedPage> => {
  throwIfAborted(signal);

  try {
    const html = await fetchText(url, "search-api", signal, {
      redirect: "follow",
    });
    const $ = cheerio.load(html);

    $("script, style, noscript, nav, footer, header, aside").remove();

    const title = normalizeWhitespace($("title").first().text()) || url;
    const description =
      normalizeWhitespace(
        $('meta[name="description"]').attr("content") ||
          $('meta[property="og:description"]').attr("content") ||
          "",
      ) || "No description available.";
    const text = normalizeWhitespace(
      $("article").text() || $("main").text() || $("body").text(),
    );

    return {
      title,
      url,
      description,
      excerpt: text.slice(0, 1_600),
    };
  } catch (error) {
    if (error instanceof SearchToolError) {
      throw error;
    }
    if (isAbortError(error)) {
      throw new SearchToolError("Request aborted.", "aborted", "search-api");
    }
    throw new SearchToolError(
      "Page fetch failed.",
      "network",
      "search-api",
      error instanceof Error ? error.message : String(error),
    );
  }
};

export const searchKnowledgeBase = async ({
  query,
  signal,
  onProgress,
}: {
  query: string;
  signal?: AbortSignal;
  onProgress?: (progress: ToolProgress) => void;
}): Promise<KnowledgeBaseSearchResponse> => {
  throwIfAborted(signal);

  const queryTokens = tokenize(query);
  const queryGrams = buildCounter(buildCharGrams(query));
  const avgDocLength =
    knowledgeBaseDocuments.reduce(
      (total, document) => total + tokenize(`${document.title} ${document.content}`).length,
      0,
    ) / Math.max(knowledgeBaseDocuments.length, 1);

  onProgress?.({
    callId: "",
    tool: "knowledgeBaseSearch",
    message: "正在执行混合检索（稀疏 + 密集）",
    provider: "knowledge-base",
  });

  let strategy: "hybrid" | "dense-only" = "hybrid";
  let documents: RetrievalDocument[] = [];

  try {
    const sparseRanked = knowledgeBaseDocuments
      .map((document) => {
        const docTokens = tokenize(`${document.title} ${document.content} ${document.tags.join(" ")}`);
        const sparseScore = queryTokens.reduce((score, token) => {
          const tf = docTokens.filter((item) => item === token).length;
          if (tf === 0) {
            return score;
          }

          const df = knowledgeBaseDocuments.filter((candidate) =>
            tokenize(`${candidate.title} ${candidate.content} ${candidate.tags.join(" ")}`).includes(
              token,
            ),
          ).length;
          const idf = Math.log(1 + (knowledgeBaseDocuments.length - df + 0.5) / (df + 0.5));
          const k1 = 1.5;
          const b = 0.75;
          return (
            score +
            (idf * tf * (k1 + 1)) /
              (tf + k1 * (1 - b + b * (docTokens.length / Math.max(avgDocLength, 1))))
          );
        }, 0);

        const denseScore = cosineFromCounters(
          queryGrams,
          buildCounter(buildCharGrams(`${document.title} ${document.content}`)),
        );

        return { document, sparseScore, denseScore };
      })
      .sort((left, right) => right.sparseScore - left.sparseScore);

    const denseRanked = [...sparseRanked].sort((left, right) => right.denseScore - left.denseScore);

    documents = knowledgeBaseDocuments
      .map((document) => {
        const sparseRank = sparseRanked.findIndex((entry) => entry.document.id === document.id) + 1;
        const denseRank = denseRanked.findIndex((entry) => entry.document.id === document.id) + 1;
        const sparseScore = sparseRanked.find((entry) => entry.document.id === document.id)?.sparseScore ?? 0;
        const denseScore = denseRanked.find((entry) => entry.document.id === document.id)?.denseScore ?? 0;

        return {
          id: document.id,
          title: document.title,
          source: document.source,
          url: document.url,
          content: document.content,
          metadata: { tags: document.tags },
          scores: {
            sparse: sparseScore,
            dense: denseScore,
            rrf: reciprocalRankFusion(sparseRank, denseRank),
            final: reciprocalRankFusion(sparseRank, denseRank),
          },
        } satisfies RetrievalDocument;
      })
      .sort((left, right) => right.scores.final - left.scores.final)
      .slice(0, agentEnv.knowledgeBaseMaxResults);
  } catch {
    strategy = "dense-only";
    onProgress?.({
      callId: "",
      tool: "knowledgeBaseSearch",
      message: "混合检索降级为纯密集检索",
      provider: "knowledge-base",
    });

    documents = knowledgeBaseDocuments
      .map((document) => {
        const denseScore = cosineFromCounters(
          queryGrams,
          buildCounter(buildCharGrams(`${document.title} ${document.content}`)),
        );

        return {
          id: document.id,
          title: document.title,
          source: document.source,
          url: document.url,
          content: document.content,
          metadata: { tags: document.tags },
          scores: {
            dense: denseScore,
            final: denseScore,
          },
        } satisfies RetrievalDocument;
      })
      .sort((left, right) => right.scores.final - left.scores.final)
      .slice(0, agentEnv.knowledgeBaseMaxResults);
  }

  let reranked = false;
  if (documents.length > 0 && agentEnv.jinaApiKey) {
    onProgress?.({
      callId: "",
      tool: "knowledgeBaseSearch",
      message: "正在调用 Jina Rerank 精排",
      provider: "knowledge-base",
    });

    try {
      const response = await withTimeout(
        (innerSignal) =>
          fetch("https://api.jina.ai/v1/rerank", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${agentEnv.jinaApiKey}`,
            },
            body: JSON.stringify({
              model: agentEnv.jinaRerankModel,
              query,
              documents: documents.map((document) => document.content),
            }),
            signal: innerSignal,
          }),
        agentEnv.webFetchTimeoutMs,
        signal,
      );

      if (!response.ok) {
        throw new Error(`Jina rerank failed with status ${response.status}`);
      }

      const payload = (await response.json()) as {
        results?: Array<{ index: number; relevance_score: number }>;
      };

      const scoreMap = new Map<number, number>();
      for (const item of payload.results ?? []) {
        scoreMap.set(item.index, item.relevance_score);
      }

      documents = documents
        .map((document, index) => ({
          ...document,
          scores: {
            ...document.scores,
            rerank: scoreMap.get(index) ?? document.scores.final,
            final: scoreMap.get(index) ?? document.scores.final,
          },
        }))
        .sort((left, right) => right.scores.final - left.scores.final);
      reranked = true;
    } catch {
      onProgress?.({
        callId: "",
        tool: "knowledgeBaseSearch",
        message: "Jina 精排失败，继续使用本地 hybrid 排序",
        provider: "knowledge-base",
      });
    }
  }

  return {
    provider: "knowledge-base",
    documents,
    strategy,
    reranked,
  };
};

export const lookupWeather = async ({
  location,
  signal,
}: {
  location: string;
  signal?: AbortSignal;
}): Promise<WeatherResult> => {
  throwIfAborted(signal);

  const response = await withTimeout(
    (innerSignal) =>
      fetch(
        `${agentEnv.weatherApiBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(location)}?format=j1`,
        {
          headers: {
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0 Agent Workspace",
          },
          signal: innerSignal,
        },
      ),
    agentEnv.webFetchTimeoutMs,
    signal,
  );

  if (!response.ok) {
    throw new SearchToolError(
      `Weather lookup failed with status ${response.status}.`,
      "http",
      "weather-api",
      `HTTP ${response.status}`,
    );
  }

  const payload = (await response.json()) as {
    current_condition?: Array<{
      temp_C?: string;
      FeelsLikeC?: string;
      humidity?: string;
      windspeedKmph?: string;
      weatherDesc?: Array<{ value?: string }>;
    }>;
    nearest_area?: Array<{ areaName?: Array<{ value?: string }> }>;
  };

  const current = payload.current_condition?.[0];
  const actualLocation = payload.nearest_area?.[0]?.areaName?.[0]?.value ?? location;

  return {
    location: actualLocation,
    summary: current?.weatherDesc?.[0]?.value ?? "No weather summary available.",
    temperatureC: current?.temp_C ? Number(current.temp_C) : null,
    feelsLikeC: current?.FeelsLikeC ? Number(current.FeelsLikeC) : null,
    humidity: current?.humidity ? Number(current.humidity) : null,
    windKph: current?.windspeedKmph ? Number(current.windspeedKmph) : null,
  };
};
