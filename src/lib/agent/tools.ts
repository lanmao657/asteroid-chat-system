import * as cheerio from "cheerio";

import { agentEnv } from "@/lib/agent/env";
import { knowledgeBaseDocuments } from "@/lib/agent/knowledge-base";
import { webSearch, WebSearchError } from "@/tools/webSearch";
import type {
  FetchedPage,
  KnowledgeBaseRetrievalAssessment,
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
  queryUsed?: string;
  rawCount?: number;
  normalizedCount?: number;
  filterReasons?: Record<string, number>;
  attempts?: Array<{
    provider: SearchProviderName;
    query: string;
    status: "success" | "empty" | "error";
    rawCount: number;
    normalizedCount: number;
    keptCount: number;
    filteredCount: number;
    filterReasons: Record<string, number>;
    detail?: string;
  }>;
}

export interface KnowledgeBaseSearchResponse {
  provider: "knowledge-base";
  documents: RetrievalDocument[];
  strategy: "hybrid" | "dense-only";
  reranked: boolean;
}

const SEARCH_PROVIDER_ORDER: SearchProviderName[] = [
  "tavily",
  "search-api",
  "duckduckgo-html",
  "bing-rss",
];

const BLOCKED_DOMAINS = agentEnv.searchBlockedDomains.map((item) => item.toLowerCase());
const DEMOTED_DOMAINS = agentEnv.searchDemotedDomains.map((item) => item.toLowerCase());
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
const CLEAN_NEWS_KEYWORDS = [
  "\u6700\u65b0",
  "\u6700\u8fd1",
  "\u4eca\u5929",
  "\u4eca\u65e5",
  "\u65b0\u95fb",
  "\u5b9e\u65f6",
  "\u641c\u4e00\u4e0b",
  "\u67e5\u4e00\u4e0b",
  "latest",
  "recent",
  "today",
  "current",
  "news",
  "search",
  "web",
];
const LOW_QUALITY_NEWS_DOMAINS = [
  "baidu.com",
  "jingyan.baidu.com",
  "tieba.baidu.com",
  "wordreference.com",
];
const COMMUNITY_PATTERNS =
  /question|answer|forum|community|thread|\u8d34\u5427|\u95ee\u7b54|\u77e5\u4e4e|quora|reddit/i;
const QUERY_NOISE_TERMS = new Set([
  ...CLEAN_NEWS_KEYWORDS,
  "\u91cd\u8981",
  "\u9886\u57df",
  "\u8fc7\u53bb",
  "\u4e00\u5468",
  "\u4e03\u5929",
  "\u54ea\u4e9b",
  "\u6709\u54ea\u4e9b",
  "\u6709\u4ec0\u4e48",
  "\u6807\u9898",
  "\u53d1\u5e03",
  "\u53d1\u5e03\u65f6\u95f4",
  "\u5a92\u4f53",
  "\u5a92\u4f53\u6765\u6e90",
  "\u6765\u6e90",
  "major",
  "important",
  "week",
  "weeks",
  "day",
  "days",
  "last",
  "past",
  "publish",
  "published",
  "publication",
  "source",
  "sources",
]);
const GENERIC_NEWS_ROUNDUP_TERMS = new Set([
  "国内",
  "国际",
  "国内国际",
  "国内国际要闻",
  "要闻",
  "今日要闻",
  "今天要闻",
  "重要新闻",
  "新闻摘要",
  "摘要",
  "简报",
  "晨会",
  "晨会摘要",
  "晨会同步",
  "同步",
  "头条",
  "headline",
  "headlines",
  "brief",
  "briefing",
  "roundup",
  "summary",
  "top",
]);
const AI_TOPIC_PATTERN =
  /\bai\b|artificial intelligence|\u4eba\u5de5\u667a\u80fd|\u667a\u80fd\u4f53|agent|agents|llm|\u5927\u6a21\u578b/i;
const BROAD_AI_ENTITY_QUERY = "OpenAI Anthropic Google Meta AI news last week";
const KB_QUERY_NOISE_TERMS = new Set([
  "请",
  "请问",
  "结合",
  "给出",
  "标准",
  "说法",
  "回复",
  "应该",
  "怎么",
  "如何",
  "一下",
  "一个",
  "场景",
  "时候",
  "时",
  "吗",
  "呢",
  "请按",
  "按照",
  "输出",
  "说明",
  "建议",
  "内容",
]);

interface FilterAndRankResponse {
  results: SearchResult[];
  filteredResults: SearchResult[];
  rawCount: number;
  normalizedCount: number;
  filterReasons: Record<string, number>;
}

const normalizeWhitespace = (value: string) =>
  value.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();

const extractMeaningfulTerms = (value: string) =>
  normalizeWhitespace(value)
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .filter(Boolean)
    .filter(
      (term) =>
        !QUERY_NOISE_TERMS.has(term) &&
        !GENERIC_NEWS_ROUNDUP_TERMS.has(term) &&
        !/^(?:20\d{2}|20\d{2}\u5e74)$/.test(term) &&
        !["about", "the", "a", "an", "for"].includes(term),
    );

const stripRelativeDateYear = (query: string) => {
  const normalized = normalizeWhitespace(query);
  const hasRelativeDateSignal =
    /(?:\b(?:today|current|latest|recent)\b|\u4eca\u5929|\u4eca\u65e5|\u5f53\u524d|\u5b9e\u65f6|\u6700\u65b0|\u6700\u8fd1)/i.test(
      normalized,
    );
  const hasExplicitYearReference = /(?:^|[^\d])20\d{2}(?:\u5e74)?(?=$|[^\d])/u.test(normalized);

  if (!hasRelativeDateSignal) {
    return normalized;
  }

  if (
    hasExplicitYearReference &&
    extractMeaningfulTerms(stripGenericNewsRoundupNoise(normalized)).length > 0
  ) {
    return normalized;
  }

  const currentYear = new Date().getFullYear();
  return normalizeWhitespace(
    normalized
      .replace(
        new RegExp(`(?!${currentYear}年)20\\d{2}年`, "g"),
        "",
      )
      .replace(
        new RegExp(`\\b(?!${currentYear}\\b)20\\d{2}\\b`, "g"),
        "",
      ),
  );
};

const stripGenericNewsRoundupNoise = (query: string) =>
  normalizeWhitespace(query)
    .replace(/20\d{2}年?/g, " ")
    .replace(/(?:今天|今日|当前|实时|最新|最近一周|过去7天|过去七天)/gu, " ")
    .replace(/\b(?:today|current|latest|recent|last week|past 7 days)\b/gi, " ")
    .replace(
      /(?:国内国际要闻|国内国际|今日要闻|今天要闻|重要新闻|新闻摘要|晨会摘要|晨会同步|晨会|摘要|简报|同步|头条)/gu,
      " ",
    )
    .replace(/\b(?:headline|headlines|brief|briefing|roundup|summary|top news)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

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

const unique = <T>(values: T[]) => Array.from(new Set(values));

const normalizeForMatch = (value: string) =>
  normalizeWhitespace(value).toLowerCase();

const collectChineseCorpusTerms = (value: string) => {
  const compact = normalizeForMatch(value).replace(/[^a-z0-9\u4e00-\u9fa5]/g, "");
  const terms: string[] = [];

  for (let size = 2; size <= 6; size += 1) {
    for (let index = 0; index <= compact.length - size; index += 1) {
      const candidate = compact.slice(index, index + size);
      if (/^[a-z0-9]+$/.test(candidate)) {
        continue;
      }
      if (KB_QUERY_NOISE_TERMS.has(candidate)) {
        continue;
      }
      terms.push(candidate);
    }
  }

  return unique(terms);
};

const extractKnowledgeQueryTerms = (query: string, corpusTexts: string[]) => {
  const normalized = normalizeForMatch(query);
  const englishTerms = normalized
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .filter(Boolean)
    .filter((term) => /[a-z0-9]/.test(term))
    .filter((term) => term.length > 1)
    .filter((term) => !KB_QUERY_NOISE_TERMS.has(term));
  const chineseCandidates = collectChineseCorpusTerms(normalized);
  const corpus = corpusTexts
    .map((text) => normalizeForMatch(text))
    .join(" ");

  const candidates = unique([...englishTerms, ...chineseCandidates])
    .filter((term) => term.length > 1)
    .filter((term) => corpus.includes(term))
    .sort((left, right) => right.length - left.length);

  const selected: string[] = [];
  for (const term of candidates) {
    if (selected.some((existing) => existing.includes(term))) {
      continue;
    }
    selected.push(term);
    if (selected.length >= 8) {
      break;
    }
  }

  return selected;
};

const reciprocalRankFusion = (...ranks: number[]) =>
  ranks.reduce((total, rank) => total + 1 / (60 + rank), 0);

const matchesDomainList = (domain: string, list: string[]) =>
  list.some((item) => domain === item || domain.endsWith(`.${item}`));

const isNewsLikeQuery = (query: string) => {
  const normalized = query.toLowerCase();
  return CLEAN_NEWS_KEYWORDS.some((keyword) => normalized.includes(keyword));
};

const extractQueryTerms = (query: string) =>
  {
    const extracted = extractMeaningfulTerms(stripRelativeDateYear(query));

    if (
      (/\bartificial\b/.test(extracted.join(" ")) || extracted.includes("intelligence")) &&
      !extracted.includes("ai")
    ) {
      extracted.unshift("ai");
    }

    return dedupeStrings(extracted);
  };

const isGenericNewsRoundupQuery = (query: string) => {
  const normalized = stripRelativeDateYear(query);
  if (!isNewsLikeQuery(normalized)) {
    return false;
  }

  const compact = stripGenericNewsRoundupNoise(normalized);
  if (!compact) {
    return true;
  }

  const extracted = extractMeaningfulTerms(compact);

  return dedupeStrings(extracted).length === 0;
};

const dedupeStrings = (values: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values.map((item) => normalizeWhitespace(item)).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }

  return result;
};

const buildTopicLabels = (query: string) => {
  const normalized = stripRelativeDateYear(query);
  const lower = normalized.toLowerCase();

  if (/openai/i.test(normalized)) {
    return { topicEn: "OpenAI", topicZh: "OpenAI", broadAi: false };
  }

  if (/anthropic/i.test(normalized)) {
    return { topicEn: "Anthropic", topicZh: "Anthropic", broadAi: false };
  }

  if (/google|gemini/i.test(normalized)) {
    return { topicEn: "Google AI", topicZh: "Google AI", broadAi: false };
  }

  if (/meta|llama/i.test(normalized)) {
    return { topicEn: "Meta AI", topicZh: "Meta AI", broadAi: false };
  }

  if (/microsoft/i.test(normalized)) {
    return { topicEn: "Microsoft AI", topicZh: "Microsoft AI", broadAi: false };
  }

  if (/nvidia/i.test(normalized)) {
    return { topicEn: "NVIDIA AI", topicZh: "NVIDIA AI", broadAi: false };
  }

  if (AI_TOPIC_PATTERN.test(lower)) {
    return { topicEn: "AI", topicZh: "AI", broadAi: true };
  }

  const extracted = extractQueryTerms(normalized).slice(0, 4);
  const topic = extracted.join(" ").trim() || normalized;
  return { topicEn: topic, topicZh: topic, broadAi: false };
};

const buildQueryCandidates = (query: string) => {
  const normalized = stripRelativeDateYear(query);

  if (!isNewsLikeQuery(normalized)) {
    return [normalized];
  }

  if (isGenericNewsRoundupQuery(normalized)) {
    return dedupeStrings([
      "top news today",
      "world news today",
      "\u4eca\u65e5\u8981\u95fb",
      "\u56fd\u5185 \u56fd\u9645 \u4eca\u65e5\u8981\u95fb",
      normalized,
    ]).slice(0, 5);
  }

  const { topicEn, topicZh, broadAi } = buildTopicLabels(normalized);
  const expandedTopicEn = broadAi && topicEn === "AI" ? "artificial intelligence" : topicEn;
  const candidates = [
    `${topicEn} news last week`,
    `${expandedTopicEn} major news past 7 days`,
    broadAi ? BROAD_AI_ENTITY_QUERY : "",
    `\u6700\u8fd1\u4e00\u5468 ${topicZh} \u91cd\u8981\u65b0\u95fb`,
    `${topicZh} \u6700\u65b0\u65b0\u95fb \u8fc7\u53bb7\u5929`,
    normalized,
  ];

  return dedupeStrings(candidates).slice(0, 5);
};

const hasTopicCoverage = (query: string, result: SearchResult) => {
  if (isGenericNewsRoundupQuery(query)) {
    return (
      matchesDomainList(result.domain, TRUSTED_NEWS_DOMAINS) ||
      CLEAN_NEWS_KEYWORDS.some((keyword) =>
        `${result.title} ${result.snippet}`.toLowerCase().includes(keyword),
      )
    );
  }

  const terms = extractQueryTerms(query);
  if (terms.length === 0) {
    return true;
  }

  const haystack = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
  const matched = terms.filter((term) => haystack.includes(term));
  return matched.length >= 1;
};

const rankSearchResult = (result: SearchResult, isNewsQuery: boolean) => {
  let score = 0;
  const haystack = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
  const signals: string[] = [];

  if (isNewsQuery && CLEAN_NEWS_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
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

  if (matchesDomainList(result.domain, LOW_QUALITY_NEWS_DOMAINS)) {
    score -= 12;
    signals.push("low-quality-domain");
  }

  if (COMMUNITY_PATTERNS.test(haystack)) {
    score -= 10;
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

const countFilterReasons = (results: SearchResult[]) =>
  results.reduce<Record<string, number>>((accumulator, result) => {
    const reason = result.skipReason ?? "unknown";
    accumulator[reason] = (accumulator[reason] ?? 0) + 1;
    return accumulator;
  }, {});

const filterAndRankResults = (
  query: string,
  rawResults: SearchResult[],
): FilterAndRankResponse => {
  const filteredResults: SearchResult[] = [];
  const newsQuery = isNewsLikeQuery(query);
  const dedupedResults: SearchResult[] = [];
  const seenKeys = new Set<string>();

  for (const result of rawResults) {
    const dedupeKey = result.url || `${result.title}::${result.domain}`;
    if (seenKeys.has(dedupeKey)) {
      filteredResults.push({
        ...result,
        fetchStatus: "skipped",
        skipReason: "duplicate",
        rankingSignals: [...(result.rankingSignals ?? []), "duplicate"],
      });
      continue;
    }

    seenKeys.add(dedupeKey);
    dedupedResults.push(result);
  }

  const rankedEntries = dedupedResults
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
      const topicCovered = hasTopicCoverage(query, result);
      const isCommunity = result.rankingSignals?.includes("community-pattern");
      const isLowQualityDomain = result.rankingSignals?.includes("low-quality-domain");
      const lowScoreForNews = newsQuery && score < 2 && !result.rankingSignals?.includes("trusted-domain");
      const lowQualityForNews =
        newsQuery && (!topicCovered || Boolean(isCommunity) || Boolean(isLowQualityDomain) || lowScoreForNews);

      if (lowQualityForNews) {
        const skipReason = !topicCovered
          ? "topic-mismatch"
          : isCommunity
            ? "community-pattern"
            : isLowQualityDomain
              ? "low-quality-domain"
              : "low-score";
        filteredResults.push({
          ...result,
          fetchStatus: "skipped",
          skipReason,
          rankingSignals: [...(result.rankingSignals ?? []), "filtered-low-quality-news"],
        });
        return null;
      }

      return { result, score };
    })
    .filter((entry): entry is { result: SearchResult; score: number } => Boolean(entry))
    .sort((left, right) => right.score - left.score);

  const ranked: SearchResult[] = [];
  for (const [index, entry] of rankedEntries.entries()) {
    const passesNewsThreshold =
      !newsQuery || entry.score >= 2 || index < Math.min(3, agentEnv.searchMaxResults);

    if (!passesNewsThreshold) {
      filteredResults.push({
        ...entry.result,
        fetchStatus: "skipped",
        skipReason: "score-threshold",
      });
      continue;
    }

    if (ranked.length >= agentEnv.searchMaxResults) {
      filteredResults.push({
        ...entry.result,
        fetchStatus: "skipped",
        skipReason: "result-limit",
      });
      continue;
    }

    ranked.push(entry.result);
  }

  return {
    results: ranked,
    filteredResults,
    rawCount: rawResults.length,
    normalizedCount: dedupedResults.length,
    filterReasons: countFilterReasons(filteredResults),
  };
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
  if (provider === "tavily") {
    const response = await webSearch(query, { signal });
    if (response.status === "empty") {
      throw new SearchToolError("Tavily returned no results.", "empty", "tavily");
    }

    return filterAndRankResults(
      query,
      response.results.map((result) =>
        createSearchResult(result.title, result.url, result.content),
      ),
    );
  }
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
  const queryCandidates = buildQueryCandidates(query);
  const totalAttempts = orderedProviders.length * queryCandidates.length;
  let lastError: SearchToolError | null = null;
  let lastEmptyProvider: SearchProviderName | null = null;
  let lastAttemptQuery = query;
  const attempts: NonNullable<SearchResponse["attempts"]> = [];

  for (const [providerIndex, provider] of orderedProviders.entries()) {
    for (const [queryIndex, candidateQuery] of queryCandidates.entries()) {
      throwIfAborted(signal);
      lastAttemptQuery = candidateQuery;

      onProgress?.({
        callId: "",
        tool: "searchWeb",
        message: `Searching -> ${provider}`,
        provider,
        step: providerIndex * queryCandidates.length + queryIndex + 1,
        totalSteps: totalAttempts,
        detail: candidateQuery,
      });

      try {
        const result = await runSearchProvider(provider, candidateQuery, signal);
        attempts.push({
          provider,
          query: candidateQuery,
          status: result.results.length > 0 ? "success" : "empty",
          rawCount: result.rawCount,
          normalizedCount: result.normalizedCount,
          keptCount: result.results.length,
          filteredCount: result.filteredResults.length,
          filterReasons: result.filterReasons,
        });

        if (result.results.length > 0) {
          return {
            provider,
            ...result,
            queryUsed: candidateQuery,
            attempts,
          };
        }

        lastEmptyProvider = provider;
        onProgress?.({
          callId: "",
          tool: "searchWeb",
          message: `Retrying -> ${provider}`,
          provider,
          step: providerIndex * queryCandidates.length + queryIndex + 1,
          totalSteps: totalAttempts,
          detail: JSON.stringify({
            query: candidateQuery,
            rawCount: result.rawCount,
            normalizedCount: result.normalizedCount,
            keptCount: result.results.length,
            filteredCount: result.filteredResults.length,
            filterReasons: result.filterReasons,
          }),
        });
        continue;
      } catch (error) {
        if (error instanceof WebSearchError) {
          if (error.type === "aborted") {
            throw new SearchToolError(error.message, error.type, error.provider, error.detail);
          }

          attempts.push({
            provider: error.provider,
            query: candidateQuery,
            status: error.type === "empty" ? "empty" : "error",
            rawCount: 0,
            normalizedCount: 0,
            keptCount: 0,
            filteredCount: 0,
            filterReasons: error.type === "empty" ? { provider_empty: 1 } : {},
            detail: error.detail ?? error.message,
          });

          if (error.type === "empty") {
            lastEmptyProvider = error.provider;
            continue;
          }

          lastError = new SearchToolError(error.message, error.type, error.provider, error.detail);
          continue;
        }

        if (error instanceof SearchToolError) {
          if (error.type === "aborted") {
            throw error;
          }

          attempts.push({
            provider: error.provider,
            query: candidateQuery,
            status: error.type === "empty" ? "empty" : "error",
            rawCount: 0,
            normalizedCount: 0,
            keptCount: 0,
            filteredCount: 0,
            filterReasons: error.type === "empty" ? { provider_empty: 1 } : {},
            detail: error.detail ?? error.message,
          });

          if (error.type === "empty") {
            lastEmptyProvider = error.provider;
            continue;
          }
          lastError = error;
          continue;
        }

        if (isAbortError(error)) {
          throw new SearchToolError("Request aborted.", "aborted", provider);
        }

        const detail = error instanceof Error ? error.message : String(error);
        attempts.push({
          provider,
          query: candidateQuery,
          status: "error",
          rawCount: 0,
          normalizedCount: 0,
          keptCount: 0,
          filteredCount: 0,
          filterReasons: {},
          detail,
        });
        lastError = new SearchToolError("Search request failed.", "unknown", provider, detail);
      }
    }
  }

  if (lastEmptyProvider) {
    const lastAttempt = attempts[attempts.length - 1];
    return {
      provider: lastEmptyProvider,
      results: [],
      filteredResults: [],
      queryUsed: lastAttemptQuery,
      rawCount: lastAttempt?.rawCount ?? 0,
      normalizedCount: lastAttempt?.normalizedCount ?? 0,
      filterReasons: lastAttempt?.filterReasons ?? {},
      attempts,
    };
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
    message: "Running hybrid retrieval (sparse + dense)",
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
          metadata: {
            tags: document.tags,
            category: document.category,
            department: document.department,
            applicableRoles: document.applicableRoles,
            updatedAt: document.updatedAt,
          },
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
      message: "Hybrid retrieval degraded to dense-only retrieval",
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
          metadata: {
            tags: document.tags,
            category: document.category,
            department: document.department,
            applicableRoles: document.applicableRoles,
            updatedAt: document.updatedAt,
          },
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
      message: "Calling Jina rerank",
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
        message: "Jina rerank failed, keeping the local hybrid ranking",
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

export const assessKnowledgeBaseRetrieval = ({
  query,
  documents,
}: {
  query: string;
  documents: RetrievalDocument[];
}): KnowledgeBaseRetrievalAssessment => {
  const queryTerms = extractKnowledgeQueryTerms(query, [
    ...knowledgeBaseDocuments.map(
      (document) => `${document.title} ${document.tags.join(" ")} ${document.content}`,
    ),
    ...documents.map(
      (document) =>
        `${document.title} ${String((document.metadata?.tags as string[] | undefined)?.join(" ") ?? "")} ${document.content}`,
    ),
  ]);

  const documentMetrics = documents.map((document) => {
    const titleTagHaystack = normalizeForMatch(
      `${document.title} ${String((document.metadata?.tags as string[] | undefined)?.join(" ") ?? "")}`,
    );
    const contentHaystack = normalizeForMatch(document.content);
    const titleTagHits = queryTerms.filter((term) => titleTagHaystack.includes(term));
    const contentHits = queryTerms.filter(
      (term) => !titleTagHits.includes(term) && contentHaystack.includes(term),
    );
    const overlapCount = unique([...titleTagHits, ...contentHits]).length;

    return {
      document,
      titleTagHits,
      contentHits,
      overlapCount,
    };
  });

  const topMetric = documentMetrics[0] ?? null;
  const secondMetric = documentMetrics[1] ?? null;
  const coverageRatio =
    topMetric && queryTerms.length > 0 ? topMetric.overlapCount / queryTerms.length : 0;
  const relevantDocumentCount = documentMetrics.filter(
    (metric) => metric.titleTagHits.length > 0 || metric.overlapCount >= 2,
  ).length;
  const topGap = topMetric
    ? topMetric.overlapCount - (secondMetric?.overlapCount ?? 0)
    : 0;

  let decision: KnowledgeBaseRetrievalAssessment["decision"] = "rewrite";
  if (
    topMetric &&
    queryTerms.length > 0 &&
    topMetric.titleTagHits.length > 0 &&
    coverageRatio >= 0.4 &&
    relevantDocumentCount >= 1 &&
    topGap >= 1
  ) {
    decision = "answer";
  }

  const reasonParts = [
    queryTerms.length > 0
      ? `matched ${topMetric?.overlapCount ?? 0}/${queryTerms.length} query terms in the top document`
      : "no stable query terms were extracted from the request",
    topMetric?.titleTagHits.length
      ? `title/tag alignment on ${topMetric.titleTagHits.length} term(s)`
      : "no title/tag alignment in the top document",
    `relevant documents: ${relevantDocumentCount}`,
    `top gap: ${topGap}`,
  ];

  return {
    decision,
    decisionSource: "retrieval-heuristic",
    queryTerms,
    topDocument: topMetric
      ? {
          id: topMetric.document.id,
          title: topMetric.document.title,
          titleTagHits: topMetric.titleTagHits,
          contentHits: topMetric.contentHits,
          overlapCount: topMetric.overlapCount,
        }
      : null,
    coverageRatio: Number(coverageRatio.toFixed(3)),
    relevantDocumentCount,
    topGap,
    reason: reasonParts.join("; "),
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
