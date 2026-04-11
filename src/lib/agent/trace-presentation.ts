import type {
  RetrievalStep,
  SearchProviderName,
  ToolCall,
  ToolName,
  ToolProgress,
  ToolResult,
} from "@/lib/agent/types";

const TOOL_LABELS: Record<ToolName, string> = {
  searchWeb: "联网搜索",
  fetchWebPage: "网页抓取",
  knowledgeBaseSearch: "知识库检索",
  weatherLookup: "天气查询",
};

const PHASE_LABELS: Record<ToolCall["phase"], string> = {
  route: "路由判断",
  search: "检索",
  grade: "结果评估",
  rewrite: "查询改写",
  fetch: "页面抓取",
  rerank: "结果重排",
  weather: "天气查询",
};

const STATUS_LABELS: Record<ToolResult["status"], string> = {
  success: "成功",
  error: "失败",
  empty: "无结果",
  skipped: "已跳过",
};

const STAGE_LABELS: Record<RetrievalStep["stage"], string> = {
  routing: "路由判断",
  searching: "检索",
  grading: "结果评估",
  rewriting: "查询改写",
  reranking: "结果重排",
  fetching: "页面抓取",
  completed: "完成",
};

const PROVIDER_LABELS: Partial<Record<SearchProviderName, string>> = {
  tavily: "Tavily",
  "search-api": "Search API",
  "duckduckgo-html": "DuckDuckGo",
  "bing-rss": "Bing RSS",
  "knowledge-base": "知识库",
  "weather-api": "天气服务",
};

const ROUTE_LABELS: Record<string, string> = {
  web: "联网搜索",
  "knowledge-base": "知识库",
  weather: "天气查询",
  none: "直接回答",
};

const REWRITE_MODE_LABELS: Record<string, string> = {
  "step-back": "Step-Back",
  hyde: "HyDE",
};

const DECISION_LABELS: Record<string, string> = {
  answer: "直接回答",
  rewrite: "改写后重试",
};

const STRATEGY_LABELS: Record<string, string> = {
  hybrid: "混合",
  sparse: "稀疏",
  dense: "向量",
};

const localizeRoute = (route: string) => ROUTE_LABELS[route] ?? route;

const localizeRewriteMode = (mode: string) => REWRITE_MODE_LABELS[mode] ?? mode;

const localizeDecision = (decision: string) => DECISION_LABELS[decision] ?? decision;

const localizeStrategy = (strategy: string) => STRATEGY_LABELS[strategy] ?? strategy;

export const localizeToolName = (tool: ToolName) => TOOL_LABELS[tool] ?? tool;

export const localizeToolPhase = (phase: ToolCall["phase"]) => PHASE_LABELS[phase] ?? phase;

export const localizeToolStatus = (status: ToolResult["status"]) =>
  STATUS_LABELS[status] ?? status;

export const localizeProviderName = (provider?: SearchProviderName | string) =>
  (provider && PROVIDER_LABELS[provider as SearchProviderName]) || provider || "";

export const localizeTraceText = (text: string) => {
  if (!text) {
    return text;
  }

  if (text === "Compacted older messages and kept recent context.") {
    return "已压缩较早的对话内容，并保留最近上下文。";
  }
  if (text === "Failed to summarize older messages, reusing the existing memory summary.") {
    return "旧消息摘要失败，已继续复用现有记忆摘要。";
  }
  if (text === "Current answer was aborted.") {
    return "当前回答已中断。";
  }
  if (text === "Choose the best retrieval tool among weather, knowledge base, and web search.") {
    return "正在从天气、知识库和联网搜索中选择最合适的检索方式。";
  }
  if (text === "Querying the weather service.") {
    return "正在查询天气服务。";
  }
  if (text === "Checking whether the retrieved documents are sufficient to answer.") {
    return "正在判断当前检索结果是否足以回答问题。";
  }
  if (text === "Rewriting the knowledge-base query because the retrieved documents are weak.") {
    return "当前检索结果偏弱，正在改写知识库查询。";
  }
  if (text === "The previous pass hit the output limit, so the assistant is continuing the same answer without restarting it.") {
    return "上一轮输出触达上限，助手会在不重写前文的前提下继续生成。";
  }
  if (text.startsWith("The answer hit the single-pass output limit and already used ")) {
    return text.replace(
      /^The answer hit the single-pass output limit and already used (\d+) continuation attempts\.$/,
      "回答单轮输出已达上限，且已经使用了 $1 次续写机会。",
    );
  }
  if (text === "web_search finished.") {
    return "联网搜索完成。";
  }
  if (text === "Weather results are ready for the answer.") {
    return "天气结果已可用于生成回答。";
  }
  if (text === "Jina API reranking completed.") {
    return "Jina API 重排已完成。";
  }
  if (text === "Jina reranking unavailable, using local ranking instead.") {
    return "Jina 重排不可用，已改用本地排序。";
  }
  if (text === "Knowledge-base retrieval finished.") {
    return "知识库检索完成。";
  }
  if (text === "web_search tool calling is unavailable for the current model endpoint.") {
    return "当前模型端点不支持联网搜索工具调用。";
  }
  if (text === "Model chose not to call web_search for this request.") {
    return "模型判断此请求无需调用联网搜索。";
  }
  if (text === "Model chose not to call web_search.") {
    return "模型判断无需调用联网搜索。";
  }
  if (text === "Model requested web_search.") {
    return "模型决定调用联网搜索。";
  }
  if (text === "Model returned an empty web_search query.") {
    return "模型返回了空的联网搜索查询。";
  }
  if (text === "Model returned invalid web_search arguments.") {
    return "模型返回的联网搜索参数无效。";
  }
  if (text === "Mock provider skipped web_search.") {
    return "Mock 提供方未调用联网搜索。";
  }
  if (text === "Mock provider requested web_search.") {
    return "Mock 提供方请求调用联网搜索。";
  }
  if (text === "rewrite requested") {
    return "已触发查询改写。";
  }

  let match = text.match(/^Routing -> (.+)$/);
  if (match) {
    return `路由判断 -> ${localizeRoute(match[1])}`;
  }

  match = text.match(/^Searching -> (.+)$/);
  if (match) {
    if (match[1] === "web_search") {
      return "检索中 -> 联网搜索";
    }
    if (match[1] === "Weather API") {
      return "检索中 -> 天气服务";
    }
    if (match[1] === "外部补充") {
      return "检索中 -> 外部补充";
    }
    return `检索中 -> ${localizeProviderName(match[1])}`;
  }

  match = text.match(/^Retrying -> (.+)$/);
  if (match) {
    return `重试中 -> ${localizeProviderName(match[1])}`;
  }

  match = text.match(/^Fetching -> (.+)$/);
  if (match) {
    return `抓取页面 -> ${match[1]}`;
  }

  match = text.match(/^Grading -> (.+)$/);
  if (match) {
    return `结果评估 -> ${match[1] === "grade_documents" ? "文档充分性" : match[1]}`;
  }

  match = text.match(/^Rewriting -> (.+)$/);
  if (match) {
    return `查询改写 -> ${localizeRewriteMode(match[1])}`;
  }

  match = text.match(/^Continuing answer \((\d+)\/(\d+)\)$/);
  if (match) {
    return `继续生成回答（${match[1]}/${match[2]}）`;
  }

  if (text === "Continuing -> limit reached") {
    return "继续生成 -> 已达上限";
  }

  match = text.match(/^Selected (.+) route for this turn\.$/);
  if (match) {
    return `本轮已选择${localizeRoute(match[1])}路线。`;
  }

  match = text.match(/^Weather lookup for (.+)$/);
  if (match) {
    return `正在查询 ${match[1]} 的天气。`;
  }

  match = text.match(/^Weather lookup completed: (.+?), (.+)$/);
  if (match) {
    return `天气查询完成：${match[1]}，${match[2]}`;
  }

  match = text.match(/^Knowledge-base (.+) search completed with (\d+) candidate\(s\)\.$/);
  if (match) {
    return `知识库${localizeStrategy(match[1])}检索完成，共获得 ${match[2]} 个候选结果。`;
  }

  match = text.match(
    /^Knowledge-base retrieval completed with (\d+) candidate\(s\); grading decision: (.+)\.$/,
  );
  if (match) {
    return `知识库检索完成，共获得 ${match[1]} 个候选结果；评估结论：${localizeDecision(match[2])}。`;
  }

  match = text.match(/^Web search completed with (\d+) usable result\(s\)\.$/);
  if (match) {
    return `联网搜索完成，得到 ${match[1]} 条可用结果。`;
  }

  match = text.match(
    /^External web research added (\d+) usable result\(s\) for policy or industry context\.$/,
  );
  if (match) {
    return `已补充 ${match[1]} 条外部结果，用于政策或行业背景参考。`;
  }

  if (text === "Live web search was attempted, but current providers did not return enough reliable results.") {
    return "已尝试联网搜索，但当前提供方没有返回足够可靠的结果。";
  }

  if (text === "Weather lookup failed, so this turn falls back to a direct answer.") {
    return "天气查询失败，本轮将回退为直接回答。";
  }
  if (text === "Knowledge-base retrieval failed, so this turn falls back to a direct answer.") {
    return "知识库检索失败，本轮将回退为直接回答。";
  }
  if (text === "Web retrieval failed, so this turn falls back to a direct answer.") {
    return "联网检索失败，本轮将回退为直接回答。";
  }
  if (text === "Weather lookup stopped with an error.") {
    return "天气查询因错误中止。";
  }
  if (text === "Knowledge-base retrieval stopped with an error.") {
    return "知识库检索因错误中止。";
  }
  if (text === "Web retrieval stopped with an error.") {
    return "联网检索因错误中止。";
  }

  match = text.match(/^web_search tool calling is unavailable \((\d+)\)\.$/);
  if (match) {
    return `当前端点不支持联网搜索工具调用（${match[1]}）。`;
  }

  return text;
};

export const formatToolStartedTitle = (toolCall: ToolCall) =>
  `${localizeToolPhase(toolCall.phase)} -> ${localizeToolName(toolCall.tool)}`;

export const formatToolProgressMessage = (progress: ToolProgress) =>
  localizeTraceText(progress.message);

export const formatToolResultTitle = (toolResult: ToolResult) => {
  const provider = localizeProviderName(toolResult.provider);
  return provider
    ? `${localizeToolName(toolResult.tool)} · ${provider} · ${localizeToolStatus(toolResult.status)}`
    : `${localizeToolName(toolResult.tool)} · ${localizeToolStatus(toolResult.status)}`;
};

export const formatToolResultSummary = (toolResult: ToolResult) =>
  localizeTraceText(toolResult.summary);

export const formatRetrievalTrace = (trace: RetrievalStep[]) =>
  trace
    .map(
      (step, index) =>
        `${index + 1}. ${STAGE_LABELS[step.stage] ?? localizeTraceText(step.label)}：${localizeTraceText(step.detail)}`,
    )
    .join("\n");

export const formatToolResultDetail = (toolResult: ToolResult) => {
  if (toolResult.trace && toolResult.trace.length > 0) {
    return formatRetrievalTrace(toolResult.trace);
  }
  if (toolResult.detail) {
    return localizeTraceText(toolResult.detail);
  }
  return "";
};
