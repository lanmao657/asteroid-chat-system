import * as cheerio from "cheerio";

import { agentEnv } from "@/lib/agent/env";
import type {
  FetchedPage,
  SearchProviderName,
  SearchResult,
  ToolErrorType,
} from "@/lib/agent/types";

export class SearchToolError extends Error {
  constructor(
    message: string,
    public readonly type: ToolErrorType,
    public readonly provider: SearchProviderName,
    public readonly userMessage: string,
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
  attempts: Array<{
    provider: SearchProviderName;
    ok: boolean;
    errorType?: ToolErrorType;
    detail?: string;
  }>;
}

const SEARCH_PROVIDER_ORDER = ["search-api", "duckduckgo-html", "bing-rss"] as const;
const BLOCKED_DOMAINS = agentEnv.searchBlockedDomains.map((item) => item.toLowerCase());
const DEMOTED_DOMAINS = agentEnv.searchDemotedDomains.map((item) => item.toLowerCase());
const NEWS_KEYWORDS = agentEnv.searchNewsKeywords.map((item) => item.toLowerCase());
const TRUSTED_NEWS_DOMAINS = [
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "bbc.co.uk",
  "cnn.com",
  "nytimes.com",
  "theverge.com",
  "techcrunch.com",
  "wired.com",
  "36kr.com",
  "huxiu.com",
  "cls.cn",
  "caixin.com",
  "ithome.com",
  "sina.com.cn",
  "qq.com",
  "163.com",
  "sohu.com",
  "jiemian.com",
];
const SEARCH_RETRY_COUNT = 2;

const withTimeout = async <T>(
  factory: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await Promise.race([
      factory(controller.signal),
      new Promise<T>((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new Error(`Timed out after ${timeoutMs}ms`));
        });
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeWhitespace = (value: string) =>
  value.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();

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

const matchesDomainList = (domain: string, list: string[]) =>
  list.some((item) => domain === item || domain.endsWith(`.${item}`));

const isNewsLikeQuery = (query: string) => {
  const normalized = query.toLowerCase();
  return NEWS_KEYWORDS.some((keyword) => normalized.includes(keyword));
};

const normalizeSearchQuery = (query: string) => {
  const trimmed = query.trim();
  if (isNewsLikeQuery(trimmed) || /20\d{2}/.test(trimmed)) {
    return trimmed.includes("新闻") ? trimmed : `${trimmed} 新闻`;
  }

  return trimmed;
};

const createSearchResult = (
  title: string,
  url: string,
  snippet: string,
): SearchResult => ({
  title,
  url,
  snippet,
  domain: extractDomain(url),
  evidence: "search-snippet",
  fetchStatus: "pending",
  rankingSignals: [],
});

const createSearchError = (
  provider: SearchProviderName,
  error: unknown,
): SearchToolError => {
  if (error instanceof SearchToolError) {
    return error;
  }

  if (error instanceof Error) {
    if (error.name === "AbortError" || error.message.startsWith("Timed out")) {
      return new SearchToolError(
        `Search request timed out for ${provider}.`,
        "timeout",
        provider,
        "搜索工具超时了，请稍后重试或换个关键词。",
        error.message,
      );
    }

    const lower = error.message.toLowerCase();
    if (lower.includes("fetch failed") || lower.includes("network")) {
      return new SearchToolError(
        `Search request failed for ${provider}.`,
        "network",
        provider,
        "搜索工具请求失败了，请稍后重试。",
        error.message,
      );
    }
  }

  return new SearchToolError(
    `Search request failed for ${provider}.`,
    "unknown",
    provider,
    "搜索工具暂时不可用，请稍后再试。",
    error instanceof Error ? error.message : String(error),
  );
};

const enabledProviders = Array.from(
  new Set<SearchProviderName>(
    agentEnv.searchProviders.filter((value): value is SearchProviderName =>
      SEARCH_PROVIDER_ORDER.includes(value as SearchProviderName),
    ),
  ),
);

const orderedProviders =
  enabledProviders.length > 0 ? enabledProviders : [...SEARCH_PROVIDER_ORDER];

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

const fetchSearchResponse = async (
  provider: SearchProviderName,
  url: string,
  signal: AbortSignal,
) => {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 Agent MVP",
      Accept:
        provider === "bing-rss"
          ? "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8"
          : "text/html,application/xhtml+xml",
    },
    signal,
  });

  if (!response.ok) {
    throw new SearchToolError(
      `Search failed with status ${response.status} for ${provider}.`,
      "http",
      provider,
      "搜索服务返回了异常状态，请稍后重试。",
      `HTTP ${response.status}`,
    );
  }

  return response.text();
};

const rankSearchResult = (result: SearchResult, isNewsQuery: boolean) => {
  let score = 0;
  const haystack = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
  const signals: string[] = [];

  if (isNewsQuery) {
    const matchingNewsKeyword = NEWS_KEYWORDS.find((keyword) => haystack.includes(keyword));
    if (matchingNewsKeyword) {
      score += 10;
      signals.push(`news-keyword:${matchingNewsKeyword}`);
    }
  }

  if (matchesDomainList(result.domain, TRUSTED_NEWS_DOMAINS)) {
    score += 12;
    signals.push("trusted-news-domain");
  }

  if (/20\d{2}|发布|报道|news|update|announc/i.test(haystack)) {
    score += 4;
    signals.push("timeliness-signal");
  }

  if (matchesDomainList(result.domain, DEMOTED_DOMAINS)) {
    score -= 8;
    signals.push("demoted-domain");
  }

  if (/question|answer|问答|知道|贴吧|community|forum/.test(haystack)) {
    score -= 6;
    signals.push("community-pattern");
  }

  result.rankingSignals = signals;
  return score;
};

const filterAndRankResults = (query: string, rawResults: SearchResult[]) => {
  const newsQuery = isNewsLikeQuery(query);
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

      const score = rankSearchResult(result, newsQuery);
      return { result, score };
    })
    .filter(
      (
        entry,
      ): entry is {
        result: SearchResult;
        score: number;
      } => Boolean(entry),
    )
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.result)
    .slice(0, agentEnv.searchMaxResults)
    .map((result) => ({
      ...result,
      fetchStatus: "pending" as const,
    }));

  if (!ranked.length && filteredResults.length) {
    throw new SearchToolError(
      "All search results were blocked.",
      "empty",
      "search-api",
      "搜索结果都来自明确受限的站点，请换个关键词再试。",
      `Filtered ${filteredResults.length} blocked results.`,
    );
  }

  return {
    results: ranked,
    filteredResults,
  };
};

const searchApi = async (query: string, signal: AbortSignal) => {
  const provider: SearchProviderName = "search-api";

  if (!agentEnv.searchApiKey) {
    throw new SearchToolError(
      "Search API key is missing.",
      "unknown",
      provider,
      "主实时检索服务尚未配置，正在切换到备用搜索源。",
    );
  }

  const response = await fetch(agentEnv.searchApiBaseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": agentEnv.searchApiKey,
    },
    body: JSON.stringify({
      q: normalizeSearchQuery(query),
      num: Math.max(agentEnv.searchMaxResults * 3, 10),
    }),
    signal,
  });

  if (!response.ok) {
    throw new SearchToolError(
      `Search API failed with status ${response.status}.`,
      "http",
      provider,
      "主实时检索服务暂时不可用，正在切换到备用搜索源。",
      `HTTP ${response.status}`,
    );
  }

  const payload = (await response.json()) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
  };

  const results = (payload.organic ?? [])
    .map((item) => {
      const title = normalizeWhitespace(item.title ?? "");
      const url = normalizeWhitespace(item.link ?? "");
      const snippet = normalizeWhitespace(item.snippet ?? "");
      return title && url ? createSearchResult(title, url, snippet) : null;
    })
    .filter((entry): entry is SearchResult => Boolean(entry));

  if (!results.length) {
    throw new SearchToolError(
      "Search API returned no results.",
      "empty",
      provider,
      "主实时检索服务没有返回相关结果，正在尝试备用搜索源。",
    );
  }

  const processed = filterAndRankResults(query, results);
  return {
    provider,
    results: processed.results,
    filteredResults: processed.filteredResults,
  };
};

const searchDuckDuckGoHtml = async (query: string, signal: AbortSignal) => {
  const provider: SearchProviderName = "duckduckgo-html";
  const html = await fetchSearchResponse(
    provider,
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(normalizeSearchQuery(query))}`,
    signal,
  );

  const $ = cheerio.load(html);
  const results: SearchResult[] = [];

  $(".result").each((_, element) => {
    if (results.length >= agentEnv.searchMaxResults * 3) {
      return false;
    }

    const titleNode = $(element).find(".result__title a").first();
    const snippetNode = $(element).find(".result__snippet").first();
    const title = normalizeWhitespace(titleNode.text());
    const url = decodeDuckDuckGoUrl(titleNode.attr("href") ?? "");
    const snippet = normalizeWhitespace(snippetNode.text());

    if (title && url) {
      results.push(createSearchResult(title, url, snippet));
    }

    return undefined;
  });

  if (!results.length) {
    throw new SearchToolError(
      "DuckDuckGo HTML returned no results.",
      "empty",
      provider,
      "备用搜索源没有找到结果。",
      "No result items were parsed from the HTML response.",
    );
  }

  const processed = filterAndRankResults(query, results);
  return {
    provider,
    results: processed.results,
    filteredResults: processed.filteredResults,
  };
};

const searchBingRss = async (query: string, signal: AbortSignal) => {
  const provider: SearchProviderName = "bing-rss";
  const xml = await fetchSearchResponse(
    provider,
    `https://www.bing.com/search?format=rss&q=${encodeURIComponent(normalizeSearchQuery(query))}`,
    signal,
  );

  const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  const results = itemMatches
    .slice(0, agentEnv.searchMaxResults * 3)
    .map((match) => {
      const block = match[1];
      const title = normalizeWhitespace(
        decodeXmlEntities(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ""),
      );
      const url = normalizeWhitespace(
        decodeXmlEntities(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? ""),
      );
      const snippet = normalizeWhitespace(
        decodeXmlEntities(
          block.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? "",
        ),
      );

      return title && url ? createSearchResult(title, url, snippet) : null;
    })
    .filter((entry): entry is SearchResult => Boolean(entry));

  if (!results.length) {
    throw new SearchToolError(
      "Bing RSS returned no results.",
      "empty",
      provider,
      "备用搜索源没有找到结果。",
      "No RSS items were parsed from the response.",
    );
  }

  const processed = filterAndRankResults(query, results);
  return {
    provider,
    results: processed.results,
    filteredResults: processed.filteredResults,
  };
};

const executeSearchProviderOnce = async (
  provider: SearchProviderName,
  query: string,
) =>
  withTimeout(
    async (signal) => {
      if (provider === "search-api") {
        return searchApi(query, signal);
      }
      if (provider === "duckduckgo-html") {
        return searchDuckDuckGoHtml(query, signal);
      }
      return searchBingRss(query, signal);
    },
    agentEnv.webFetchTimeoutMs,
  );

const executeSearchProvider = async (
  provider: SearchProviderName,
  query: string,
  attempts: SearchResponse["attempts"],
) => {
  let lastError: SearchToolError | null = null;

  for (let attempt = 0; attempt < SEARCH_RETRY_COUNT; attempt += 1) {
    try {
      const result = await executeSearchProviderOnce(provider, query);
      attempts.push({ provider, ok: true });
      return result;
    } catch (error) {
      const searchError = createSearchError(provider, error);
      attempts.push({
        provider,
        ok: false,
        errorType: searchError.type,
        detail: searchError.detail ?? searchError.message,
      });
      lastError = searchError;

      if (searchError.type === "empty" || searchError.type === "http") {
        break;
      }

      if (attempt < SEARCH_RETRY_COUNT - 1) {
        await sleep(250 * (attempt + 1));
      }
    }
  }

  throw lastError ?? createSearchError(provider, new Error("Unknown provider error"));
};

export const searchWeb = async (query: string): Promise<SearchResponse> => {
  const attempts: SearchResponse["attempts"] = [];
  let lastError: SearchToolError | null = null;

  for (const provider of orderedProviders) {
    try {
      const result = await executeSearchProvider(provider, query, attempts);
      return {
        ...result,
        attempts,
      };
    } catch (error) {
      lastError = createSearchError(provider, error);
    }
  }

  if (lastError) {
    throw new SearchToolError(
      lastError.message,
      lastError.type,
      lastError.provider,
      lastError.userMessage,
      JSON.stringify(attempts),
    );
  }

  throw new SearchToolError(
    "Search request failed.",
    "unknown",
    "search-api",
    "搜索工具暂时不可用，请稍后再试。",
  );
};

export const fetchWebPage = async (url: string): Promise<FetchedPage> => {
  const response = await withTimeout(
    (signal) =>
      fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 Agent MVP",
        },
        redirect: "follow",
        signal,
      }),
    agentEnv.webFetchTimeoutMs,
  );

  if (!response.ok) {
    throw new Error(`Page fetch failed with status ${response.status}`);
  }

  const html = await response.text();
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
    excerpt: text.slice(0, 1600),
  };
};
