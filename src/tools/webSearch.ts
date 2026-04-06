import { agentEnv } from "@/lib/agent/env";
import type {
  SearchProviderName,
  ToolErrorType,
  WebSearchResponse,
  WebSearchResultItem,
} from "@/lib/agent/types";

export class WebSearchError extends Error {
  constructor(
    message: string,
    public readonly type: ToolErrorType,
    public readonly provider: SearchProviderName,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "WebSearchError";
  }
}

const RECENT_SIGNALS = [
  "latest",
  "recent",
  "today",
  "current",
  "news",
  "update",
  "updates",
  "price",
  "prices",
  "version",
  "versions",
  "policy",
  "policies",
  "score",
  "scores",
  "result",
  "results",
  "\u5b98\u7f51",
  "\u6700\u65b0",
  "\u6700\u8fd1",
  "\u5b9e\u65f6",
  "\u65b0\u95fb",
  "\u4ef7\u683c",
  "\u653f\u7b56",
  "\u6bd4\u5206",
  "\u7ed3\u679c",
  "\u7248\u672c",
];

const FINANCE_SIGNALS = [
  "price",
  "prices",
  "stock",
  "stocks",
  "market",
  "earnings",
  "btc",
  "eth",
  "nasdaq",
  "finance",
  "financial",
];

const QUERY_STOPWORDS = [
  "latest",
  "recent",
  "today",
  "current",
  "news",
  "about",
  "please",
  "search",
  "look",
  "look up",
  "find",
  "the",
  "a",
  "an",
  "\u5e2e\u6211",
  "\u67e5\u4e00\u4e0b",
  "\u641c\u4e00\u4e0b",
  "\u6700\u8fd1",
  "\u6700\u65b0",
  "\u65b0\u95fb",
  "\u5b98\u7f51",
];

const normalizeWhitespace = (value: string) =>
  value.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();

const clip = (value: string, max: number) => {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, Math.max(0, max - 3))}...`;
};

const normalizeSearchQuery = (query: string) => {
  const compact = normalizeWhitespace(query);
  const lower = compact.toLowerCase();
  const isNewsQuery = RECENT_SIGNALS.some((signal) =>
    lower.includes(signal.toLowerCase()),
  );

  const topicTerms = compact
    .split(/[\s,，。！？:：；;]+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .filter((term) => !QUERY_STOPWORDS.includes(term.toLowerCase()));

  if (topicTerms.length === 0) {
    return compact;
  }

  const baseTopic = topicTerms.join(" ");
  return isNewsQuery ? `${baseTopic} news` : baseTopic;
};

const inferTopic = (query: string): "general" | "news" | "finance" => {
  const normalized = query.toLowerCase();

  if (FINANCE_SIGNALS.some((signal) => normalized.includes(signal))) {
    return "finance";
  }

  if (RECENT_SIGNALS.some((signal) => normalized.includes(signal.toLowerCase()))) {
    return "news";
  }

  return "general";
};

const mapTavilyResult = (result: {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string | null;
}): WebSearchResultItem | null => {
  const title = normalizeWhitespace(result.title ?? "");
  const url = normalizeWhitespace(result.url ?? "");
  const content = normalizeWhitespace(result.content ?? result.raw_content ?? "");

  if (!title || !url) {
    return null;
  }

  return {
    title,
    url,
    content: clip(content || title, agentEnv.webSearchContentMaxChars),
  };
};

export const webSearch = async (
  query: string,
  options?: { signal?: AbortSignal },
): Promise<WebSearchResponse> => {
  const signal = options?.signal;
  const normalizedQuery = normalizeSearchQuery(query);

  if (!agentEnv.tavilyApiKey) {
    throw new WebSearchError("Tavily API key missing.", "unknown", "tavily");
  }

  const response = await fetch(agentEnv.tavilyApiBaseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${agentEnv.tavilyApiKey}`,
    },
    body: JSON.stringify({
      query: normalizedQuery,
      topic: inferTopic(normalizedQuery),
      search_depth: "basic",
      max_results: agentEnv.searchMaxResults,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    }),
    signal,
  }).catch((error: unknown) => {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new WebSearchError("Web search aborted.", "aborted", "tavily");
    }
    throw new WebSearchError(
      "Tavily request failed.",
      "unknown",
      "tavily",
      error instanceof Error ? error.message : undefined,
    );
  });

  if (!response.ok) {
    throw new WebSearchError(
      `Tavily request failed with status ${response.status}.`,
      "http",
      "tavily",
      await response.text().catch(() => undefined),
    );
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        results?: Array<{
          title?: string;
          url?: string;
          content?: string;
          raw_content?: string | null;
        }>;
      }
    | null;

  const results = (payload?.results ?? [])
    .map((item) => mapTavilyResult(item))
    .filter((item): item is WebSearchResultItem => Boolean(item))
    .slice(0, agentEnv.searchMaxResults);

  if (results.length === 0) {
    return {
      provider: "tavily",
      status: "empty",
      results: [],
    };
  }

  return {
    provider: "tavily",
    status: "success",
    results,
  };
};
