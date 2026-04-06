const asNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asList = (value: string | undefined, fallback: string[]) => {
  const normalized = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return normalized && normalized.length > 0 ? normalized : fallback;
};

export const agentEnv = {
  modelProvider: process.env.MODEL_PROVIDER?.trim() || "openai",
  openAiCompatBaseUrl:
    process.env.OPENAI_COMPAT_BASE_URL?.trim() || "https://api.openai.com/v1",
  openAiCompatApiKey: process.env.OPENAI_COMPAT_API_KEY?.trim() || "",
  openAiModel: process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
  composeInputCharBudget: asNumber(process.env.AGENT_COMPOSE_INPUT_CHAR_BUDGET, 4_200),
  composeConversationWindow: asNumber(process.env.AGENT_CONVERSATION_WINDOW, 6),
  composeOutputTokenLimit: asNumber(process.env.AGENT_COMPOSE_OUTPUT_TOKEN_LIMIT, 700),
  maxContinuations: asNumber(process.env.AGENT_MAX_CONTINUATIONS, 2),
  continuationTailChars: asNumber(process.env.AGENT_CONTINUATION_TAIL_CHARS, 1_000),
  summaryTriggerMessages: asNumber(process.env.AGENT_SUMMARY_TRIGGER_MESSAGES, 8),
  summaryRecentWindow: asNumber(process.env.AGENT_SUMMARY_RECENT_WINDOW, 4),
  tavilyApiBaseUrl:
    process.env.TAVILY_API_BASE_URL?.trim() || "https://api.tavily.com/search",
  tavilyApiKey: process.env.TAVILY_API_KEY?.trim() || "",
  searchApiBaseUrl:
    process.env.SEARCH_API_BASE_URL?.trim() || "https://google.serper.dev/search",
  searchApiKey: process.env.SEARCH_API_KEY?.trim() || "",
  searchMaxResults: asNumber(process.env.SEARCH_MAX_RESULTS, 5),
  webSearchContentMaxChars: asNumber(process.env.WEB_SEARCH_CONTENT_MAX_CHARS, 420),
  searchProviders: asList(process.env.SEARCH_PROVIDERS, [
    "tavily",
    "search-api",
    "duckduckgo-html",
    "bing-rss",
  ]),
  fetchMaxPages: asNumber(process.env.FETCH_MAX_PAGES, 3),
  webFetchTimeoutMs: asNumber(process.env.WEB_FETCH_TIMEOUT_MS, 12_000),
  searchBlockedDomains: asList(process.env.SEARCH_BLOCKED_DOMAINS, []),
  searchDemotedDomains: asList(process.env.SEARCH_DEMOTED_DOMAINS, [
    "zhihu.com",
    "baidu.com",
    "tieba.baidu.com",
  ]),
  knowledgeBaseMaxResults: asNumber(process.env.KNOWLEDGE_BASE_MAX_RESULTS, 4),
  jinaApiKey: process.env.JINA_API_KEY?.trim() || "",
  jinaRerankModel: process.env.JINA_RERANK_MODEL?.trim() || "jina-reranker-v2-base-multilingual",
  weatherApiBaseUrl:
    process.env.WEATHER_API_BASE_URL?.trim() || "https://wttr.in",
};
