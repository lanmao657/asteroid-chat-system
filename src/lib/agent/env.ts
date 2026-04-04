const asNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asList = (value: string | undefined, fallback: string) =>
  (value?.trim() || fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const agentEnv = {
  modelProvider: process.env.MODEL_PROVIDER?.trim() || "mock",
  openAiCompatBaseUrl:
    process.env.OPENAI_COMPAT_BASE_URL?.trim() || "https://api.openai.com/v1",
  openAiCompatApiKey: process.env.OPENAI_COMPAT_API_KEY?.trim() || "",
  openAiModel: process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
  searchApiBaseUrl:
    process.env.SEARCH_API_BASE_URL?.trim() || "https://google.serper.dev/search",
  searchApiKey: process.env.SEARCH_API_KEY?.trim() || "",
  searchMaxResults: asNumber(process.env.SEARCH_MAX_RESULTS, 5),
  searchProviders: asList(
    process.env.SEARCH_PROVIDERS,
    "search-api,duckduckgo-html,bing-rss",
  ),
  searchBlockedDomains: asList(process.env.SEARCH_BLOCKED_DOMAINS, ""),
  searchDemotedDomains: asList(
    process.env.SEARCH_DEMOTED_DOMAINS,
    "zhihu.com,baidu.com,tieba.baidu.com",
  ),
  searchNewsKeywords: asList(
    process.env.SEARCH_NEWS_KEYWORDS,
    "新闻,最新,今日,today,latest,news",
  ),
  fetchMaxPages: asNumber(process.env.FETCH_MAX_PAGES, 3),
  webFetchTimeoutMs: asNumber(process.env.WEB_FETCH_TIMEOUT_MS, 12_000),
};
