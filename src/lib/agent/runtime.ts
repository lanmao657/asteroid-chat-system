import { agentEnv } from "@/lib/agent/env";
import { createProvider } from "@/lib/agent/provider";
import {
  assessKnowledgeBaseRetrieval,
  SearchToolError,
  fetchWebPage,
  lookupWeather,
  searchKnowledgeBase,
  searchWeb,
} from "@/lib/agent/tools";
import type {
  AgentRunTrace,
  AgentState,
  AgentRunTaskCategory,
  AgentStreamEvent,
  ChatMessage,
  FetchedPage,
  LLMProvider,
  ModelFinishReason,
  QueryRewriteResult,
  RetrievalDocument,
  RetrievalRoute,
  RetrievalStep,
  SearchResult,
  ToolCall,
  ToolResult,
} from "@/lib/agent/types";

type RuntimeDependencies = {
  provider: LLMProvider;
  search: typeof searchWeb;
  fetchPage: typeof fetchWebPage;
  searchKnowledgeBase: typeof searchKnowledgeBase;
  weatherLookup: typeof lookupWeather;
};

type RouteTarget = RetrievalRoute;

const SEARCH_SIGNALS = [
  "最新",
  "最近",
  "今天",
  "今日",
  "实时",
  "新闻",
  "网页",
  "搜一下",
  "查一下",
  "latest",
  "recent",
  "today",
  "current",
  "news",
  "search",
  "web",
  "官网",
];

const WEATHER_SIGNALS = ["天气", "气温", "下雨", "weather", "forecast", "temperature"];
const KNOWLEDGE_SIGNALS = [
  "知识库",
  "文档",
  "内部",
  "企业",
  "制度",
  "政策",
  "流程",
  "规范",
  "sop",
  "培训",
  "入职",
  "案例",
  "复盘",
  "报销",
  "审批",
  "客服话术",
  "销售话术",
  "faq",
  "knowledge base",
  "docs",
  "documentation",
  "kb",
  "policy",
  "process",
  "onboarding",
  "playbook",
];
const EXTERNAL_WEB_SUPPLEMENT_SIGNALS = [
  "最新",
  "最近",
  "政策变化",
  "行业",
  "监管",
  "法规",
  "竞品",
  "市场",
  "新闻",
  "外部",
  "latest",
  "recent",
  "policy change",
  "industry",
  "regulation",
  "competitor",
  "market",
  "news",
];

const isAbortError = (error: unknown, signal?: AbortSignal) =>
  signal?.aborted ||
  (error instanceof Error &&
    (error.name === "AbortError" || error.message.toLowerCase().includes("abort")));

const createToolCall = (
  tool: ToolCall["tool"],
  phase: ToolCall["phase"],
  input: Record<string, unknown>,
): ToolCall => ({
  id: crypto.randomUUID(),
  tool,
  phase,
  input,
});

const countConversationChars = (messages: ChatMessage[]) =>
  messages.reduce((total, message) => total + message.content.length, 0);

const normalizeWhitespace = (value: string) =>
  value.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();

const shouldSearch = (value: string) => {
  const normalized = value.toLowerCase();
  return SEARCH_SIGNALS.some((signal) => normalized.includes(signal.toLowerCase()));
};

const isWeatherQuery = (value: string) => {
  const normalized = value.toLowerCase();
  return WEATHER_SIGNALS.some((signal) => normalized.includes(signal.toLowerCase()));
};

const isKnowledgeQuery = (value: string) => {
  const normalized = value.toLowerCase();
  return KNOWLEDGE_SIGNALS.some((signal) => normalized.includes(signal.toLowerCase()));
};

const shouldSupplementKnowledgeWithWeb = (value: string) => {
  const normalized = value.toLowerCase();
  return EXTERNAL_WEB_SUPPLEMENT_SIGNALS.some((signal) =>
    normalized.includes(signal.toLowerCase()),
  );
};

const inferTaskCategory = (userMessage: string): AgentRunTaskCategory => {
  const normalized = userMessage.toLowerCase();

  if (
    ["培训", "入职", "学习清单", "培训手册", "培训资料", "培训课件", "onboarding", "training"].some(
      (signal) => normalized.includes(signal.toLowerCase()),
    )
  ) {
    return "training_summary";
  }

  if (
    ["制度", "政策", "报销", "审批", "合规", "规范", "policy", "reimbursement"].some((signal) =>
      normalized.includes(signal.toLowerCase()),
    )
  ) {
    return "policy_qa";
  }

  if (
    ["sop", "流程", "步骤", "怎么走", "如何操作", "退款", "客服话术", "销售话术", "faq"].some(
      (signal) => normalized.includes(signal.toLowerCase()),
    )
  ) {
    return "sop_lookup";
  }

  if (
    ["复盘", "案例", "经验教训", "回顾", "postmortem", "case review", "retro"].some((signal) =>
      normalized.includes(signal.toLowerCase()),
    )
  ) {
    return "case_review";
  }

  return "general";
};

const cleanWeatherLocationCandidate = (value: string) =>
  normalizeWhitespace(value)
    .replace(/^[,，。！？!?;；:\s-]+|[,，。！？!?;；:\s-]+$/gu, "")
    .replace(
      /^(?:(?:帮我|请|麻烦|我想知道|想知道|查一下|查一查|搜一下|搜索一下|看一下|看看|告诉我|帮忙|请问)\s*)+/u,
      "",
    )
    .replace(/\b(?:please|tell me|show me|check|what is|what's)\b/gi, "")
    .replace(/\b(?:the weather in|weather in|forecast for|forecast in|temperature in|temperature for)\b/gi, "")
    .replace(/(?:今天|今日|明天|后天|现在|当前|实时)/gu, "")
    .replace(/\b(?:today|tomorrow|now|current|currently)\b/gi, "")
    .replace(/(?:并|并且|而且|顺便|再|以及|和).*/u, "")
    .replace(/\b(?:and|with)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^的+|的+$/gu, "")
    .trim();

const extractWeatherLocation = (userMessage: string) => {
  const normalized = normalizeWhitespace(userMessage);

  const beforeChineseWeather = normalized.match(
    /(.+?)(?:今天|今日|明天|后天|现在|当前|实时)?(?:的)?(?:天气|气温|天气预报)/u,
  );
  const beforeEnglishWeather = normalized.match(
    /(.+?)\b(?:weather|forecast|temperature)\b/i,
  );
  const afterEnglishWeather = normalized.match(
    /\b(?:weather|forecast|temperature)\b(?:\s+(?:in|for|at))?\s+(.+)/i,
  );
  const afterChineseWeather = normalized.match(/(?:天气|气温|天气预报)(?:在)?(.+)/u);

  const candidates = [
    beforeChineseWeather?.[1],
    afterEnglishWeather?.[1],
    beforeEnglishWeather?.[1],
    afterChineseWeather?.[1],
  ];

  for (const candidate of candidates) {
    const cleaned = candidate ? cleanWeatherLocationCandidate(candidate) : "";
    if (cleaned) {
      return cleaned;
    }
  }

  return "Shanghai";
};

const routeRetrieval = (userMessage: string): RouteTarget => {
  if (isWeatherQuery(userMessage)) {
    return "weather";
  }
  if (isKnowledgeQuery(userMessage)) {
    return "knowledge-base";
  }
  if (shouldSearch(userMessage)) {
    return "web";
  }
  return "none";
};

const toRetrievalDocumentsFromSearch = (
  results: SearchResult[],
  pages: FetchedPage[],
): RetrievalDocument[] => {
  const pageByUrl = new Map(pages.map((page) => [page.url, page]));

  return results.map((result) => {
    const page = pageByUrl.get(result.url);
    const finalScore = result.score ? Math.max(0, result.score / 20) : 0.35;

    return {
      id: result.url,
      title: result.title,
      source: result.domain,
      url: result.url,
      content: page?.excerpt ?? result.snippet,
      metadata: {
        snippet: result.snippet,
        fetchStatus: result.fetchStatus,
        rankingSignals: result.rankingSignals,
      },
      scores: {
        dense: finalScore,
        final: finalScore,
      },
    };
  });
};

const makeStep = (
  stage: RetrievalStep["stage"],
  label: string,
  detail: string,
  metadata?: Record<string, unknown>,
): RetrievalStep => ({
  stage,
  label,
  detail,
  metadata,
});

const toTraceDocuments = (documents: RetrievalDocument[]) =>
  documents.map((document) => ({
    id: document.id,
    title: document.title,
    source: document.source,
    score: document.scores.final,
  }));

const isUsableWebResult = (result: SearchResult) => {
  const signals = result.rankingSignals ?? [];
  if (signals.includes("community-pattern")) {
    return false;
  }
  if (signals.includes("low-quality-domain")) {
    return false;
  }
  if (result.skipReason === "blocked-domain") {
    return false;
  }
  if (result.score == null) {
    return true;
  }

  if (signals.includes("trusted-domain") || signals.includes("news-keyword")) {
    return result.score >= 1;
  }

  return result.score >= -1;
};

const chooseRewriteStrategy = (turn: number): "step-back" | "hyde" =>
  turn === 0 ? "step-back" : "hyde";

const buildContinuationUserMessage = (
  originalUserMessage: string,
  assistantText: string,
  passNumber: number,
) => {
  const tail = assistantText.slice(-agentEnv.continuationTailChars).trim();

  return [
    originalUserMessage,
    "",
    `[Continuation ${passNumber}] The previous pass hit the output limit.`,
    "Continue naturally from the exact point where the answer stopped.",
    "Do not repeat earlier content, do not restart the introduction, and do not rewrite completed bullets or headings.",
    tail ? `Recent generated tail:\n\"\"\"\n${tail}\n\"\"\"` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

const streamAssistantWithContinuations = async ({
  provider,
  userMessage,
  recentConversation,
  memorySummary,
  searchResults,
  pageContents,
  retrievalDocuments,
  toolResults,
  emit,
  signal,
  onTextUpdate,
}: {
  provider: LLMProvider;
  userMessage: string;
  recentConversation: ChatMessage[];
  memorySummary: string;
  searchResults: SearchResult[];
  pageContents: FetchedPage[];
  retrievalDocuments: RetrievalDocument[];
  toolResults: ToolResult[];
  emit: (event: AgentStreamEvent) => void;
  signal?: AbortSignal;
  onTextUpdate?: (text: string) => void;
}) => {
  let assistantText = "";
  let finishReason: ModelFinishReason = "unknown";
  let continuationCount = 0;

  emit({ type: "assistant_started" });

  while (true) {
    const promptForPass =
      continuationCount === 0
        ? userMessage
        : buildContinuationUserMessage(
            userMessage,
            assistantText,
            continuationCount + 1,
          );

    let passText = "";
    const result = await provider.streamAnswer({
      userMessage: promptForPass,
      recentConversation,
      memorySummary,
      searchResults,
      pageContents,
      retrievalDocuments,
      toolResults,
      signal,
      onDelta: async (delta) => {
        passText += delta;
        assistantText += delta;
        onTextUpdate?.(assistantText);
        emit({ type: "assistant_delta", delta });
      },
    });

    if (!passText && result.text) {
      assistantText += result.text;
      onTextUpdate?.(assistantText);
      emit({ type: "assistant_delta", delta: result.text });
    }

    finishReason = result.finishReason;

    if (finishReason !== "length") {
      break;
    }

    if (continuationCount >= agentEnv.maxContinuations) {
      emit({
        type: "tool_progress",
        progress: {
          callId: `continuation:${continuationCount + 1}`,
          tool: "searchWeb",
          message: "Continuing -> limit reached",
          detail: `The answer hit the single-pass output limit and already used ${agentEnv.maxContinuations} continuation attempts.`,
        },
      });
      break;
    }

    continuationCount += 1;
    emit({
      type: "tool_progress",
      progress: {
        callId: `continuation:${continuationCount}`,
        tool: "searchWeb",
        message: `Continuing answer (${continuationCount + 1}/${agentEnv.maxContinuations + 1})`,
        detail: "The previous pass hit the output limit, so the assistant is continuing the same answer without restarting it.",
      },
    });
  }

  return {
    assistantText,
    finishReason,
    continuationCount,
  };
};

export const runAgentTurn = async ({
  sessionId,
  userMessage,
  conversation,
  memorySummary,
  emit,
  signal,
  dependencies,
}: {
  sessionId: string;
  userMessage: string;
  conversation: ChatMessage[];
  memorySummary: string;
  emit: (event: AgentStreamEvent) => void;
  signal?: AbortSignal;
  dependencies?: Partial<RuntimeDependencies>;
}): Promise<AgentState> => {
  const provider = dependencies?.provider ?? createProvider();
  const search = dependencies?.search ?? searchWeb;
  const fetchPage = dependencies?.fetchPage ?? fetchWebPage;
  const knowledgeBaseSearch = dependencies?.searchKnowledgeBase ?? searchKnowledgeBase;
  const weatherLookup = dependencies?.weatherLookup ?? lookupWeather;
  const runId = crypto.randomUUID();
  const taskCategory = inferTaskCategory(userMessage);

  emit({ type: "run_started", runId, sessionId });
  emit({
    type: "session",
    sessionId,
    provider: provider.label,
  });

  let nextMemorySummary = memorySummary;
  let recentConversation = conversation.slice(-agentEnv.summaryRecentWindow);
  const toolResults: ToolResult[] = [];
  const searchResults: SearchResult[] = [];
  const pageContents: FetchedPage[] = [];
  const retrievalDocuments: RetrievalDocument[] = [];
  let assistantText = "";
  let routed: RouteTarget = "none";
  let runTrace: AgentRunTrace | undefined;

  const abortedState = (): AgentState => ({
    sessionId,
    runId,
    userMessage,
    conversation,
    recentConversation,
    memorySummary: nextMemorySummary,
    toolResults,
    taskCategory,
    status: "aborted",
    assistantText,
    trace: runTrace,
  });

  try {
    const hasTooManyMessages = conversation.length > agentEnv.summaryTriggerMessages;
    const exceedsCharBudget =
      countConversationChars(conversation) > agentEnv.composeInputCharBudget;
    const shouldCompact = hasTooManyMessages || exceedsCharBudget;
    const olderMessages = conversation.slice(0, -agentEnv.summaryRecentWindow);

    if (shouldCompact && olderMessages.length > 0) {
      try {
        nextMemorySummary = await provider.summarizeConversation({
          existingSummary: memorySummary,
          messagesToSummarize: olderMessages,
          signal,
        });

        recentConversation = conversation.slice(-agentEnv.summaryRecentWindow);
        emit({
          type: "memory_compacted",
          summary: nextMemorySummary,
          message: "Compacted older messages and kept recent context.",
          degraded: false,
        });
      } catch (error) {
        if (isAbortError(error, signal)) {
          emit({
            type: "assistant_aborted",
            runId,
            message: "Current answer was aborted.",
          });
          return abortedState();
        }

        emit({
          type: "memory_compacted",
          summary: nextMemorySummary,
          message: "Failed to summarize older messages, reusing the existing memory summary.",
          degraded: true,
        });
      }
    }

    routed = routeRetrieval(userMessage);
    const routeCall = createToolCall("searchWeb", "route", { userMessage, route: routed });
    emit({ type: "tool_started", toolCall: routeCall });
    emit({
      type: "tool_progress",
      progress: {
        callId: routeCall.id,
        tool: "searchWeb",
        message: `Routing -> ${routed}`,
        detail: "Choose the best retrieval tool among weather, knowledge base, and web search.",
      },
    });

    const trace: RetrievalStep[] = [
      makeStep("routing", "Routing", `Selected ${routed} route for this turn.`, {
        route: routed,
        taskCategory,
      }),
    ];

    const emitRagStep = (step: RetrievalStep) => {
      emit({ type: "rag_step", step });
    };

    const runWebSearch = async (
      decision: { status: "call"; query: string; reason: string },
      reasonLabel: "requested" | "supplemental",
    ) => {
      const searchCall = createToolCall("searchWeb", "search", {
        query: decision.query,
        requestedByModel: true,
        mode: reasonLabel,
      });
      emit({ type: "tool_started", toolCall: searchCall });
      emit({
        type: "tool_progress",
        progress: {
          callId: searchCall.id,
          tool: "searchWeb",
          message:
            reasonLabel === "supplemental"
              ? "Searching -> 外部补充"
              : "Searching -> web_search",
          detail: decision.query,
        },
      });

      const response = await search({
        query: decision.query,
        signal,
        onProgress: (progress) =>
          emit({
            type: "tool_progress",
            progress: { ...progress, callId: searchCall.id },
          }),
      });

      const usableResults = response.results.filter((result) => isUsableWebResult(result));
      searchResults.splice(0, searchResults.length, ...usableResults);
      pageContents.splice(0, pageContents.length);

      for (const [index, result] of usableResults.slice(0, agentEnv.fetchMaxPages).entries()) {
        const fetchCall = createToolCall("fetchWebPage", "fetch", { url: result.url });
        emit({ type: "tool_started", toolCall: fetchCall });
        emit({
          type: "tool_progress",
          progress: {
            callId: fetchCall.id,
            tool: "fetchWebPage",
            message: `Fetching -> ${index + 1}/${Math.min(
              response.results.length,
              usableResults.length,
              agentEnv.fetchMaxPages,
            )}`,
            detail: result.url,
          },
        });

        try {
          const page = await fetchPage({ url: result.url, signal });
          pageContents.push(page);
          result.fetchStatus = "fetched";
        } catch (error) {
          if (isAbortError(error, signal)) {
            emit({
              type: "assistant_aborted",
              runId,
              message: "Current answer was aborted.",
            });
            return abortedState();
          }
          result.fetchStatus = "failed";
        }
      }

      const externalDocuments = toRetrievalDocumentsFromSearch(usableResults, pageContents);
      if (reasonLabel === "supplemental") {
        retrievalDocuments.push(...externalDocuments);
      } else {
        retrievalDocuments.splice(0, retrievalDocuments.length, ...externalDocuments);
      }

      const summary =
        usableResults.length > 0
          ? reasonLabel === "supplemental"
            ? `External web research added ${usableResults.length} usable result(s) for policy or industry context.`
            : `Web search completed with ${usableResults.length} usable result(s).`
          : "Live web search was attempted, but current providers did not return enough reliable results.";

      const webResult: ToolResult = {
        callId: searchCall.id,
        tool: "searchWeb",
        phase: "search",
        status: usableResults.length > 0 ? "success" : "empty",
        summary,
        payload: usableResults,
        provider: response.provider,
        keptCount: usableResults.length,
        filteredCount: response.filteredResults.length,
        detail: JSON.stringify({
          queryUsed: response.queryUsed ?? decision.query,
          decisionReason: decision.reason,
          providerUsed: response.provider,
          rawCount: response.rawCount ?? response.results.length + response.filteredResults.length,
          normalizedCount:
            response.normalizedCount ?? response.results.length + response.filteredResults.length,
          keptCount: usableResults.length,
          filteredCount: response.filteredResults.length,
          filterReasons: response.filterReasons ?? {},
          discardedCount: response.results.length - usableResults.length,
          attempts: response.attempts ?? [],
          mode: reasonLabel,
        }),
        trace: [
          ...trace,
          makeStep("searching", "Searching", summary, {
            provider: response.provider,
            query: response.queryUsed ?? decision.query,
            mode: reasonLabel,
          }),
          makeStep("completed", "Completed", "web_search finished."),
        ],
      };
      toolResults.push(webResult);
      emit({ type: "tool_result", toolResult: webResult });

      return null;
    };

    if (routed === "weather") {
      const weatherCall = createToolCall("weatherLookup", "weather", { query: userMessage });
      emit({ type: "tool_started", toolCall: weatherCall });
      emit({
        type: "tool_progress",
        progress: {
          callId: weatherCall.id,
          tool: "weatherLookup",
          message: "Searching -> Weather API",
          detail: "Querying the weather service.",
        },
      });

      const location = extractWeatherLocation(userMessage);
      const weather = await weatherLookup({ location, signal });

      const weatherResult: ToolResult = {
        callId: weatherCall.id,
        tool: "weatherLookup",
        phase: "weather",
        status: "success",
        summary: `Weather lookup completed: ${weather.location}, ${weather.summary}`,
        payload: weather,
        provider: "weather-api",
        trace: [
          ...trace,
          makeStep(
            "searching",
            "Searching",
            `Weather lookup for ${weather.location}`,
            weather as unknown as Record<string, unknown>,
          ),
          makeStep("completed", "Completed", "Weather results are ready for the answer."),
        ],
      };
      retrievalDocuments.push({
        id: `weather:${weather.location}`,
        title: `${weather.location} Weather`,
        source: "weather-api",
        content: JSON.stringify(weather),
        scores: { final: 0.95 },
      });
      toolResults.push(weatherResult);
      emit({ type: "tool_result", toolResult: weatherResult });
    }

    if (routed === "knowledge-base") {
      const kbCall = createToolCall("knowledgeBaseSearch", "search", { query: userMessage });
      emit({ type: "tool_started", toolCall: kbCall });
      emitRagStep(
        makeStep(
          "routing",
          "Routing",
          "Selected knowledge-base retrieval for this turn.",
          {
            route: routed,
            taskCategory,
          },
        ),
      );
      emitRagStep(
        makeStep("searching", "Searching", "Searching the knowledge base for relevant documents.", {
          query: userMessage,
        }),
      );

      const knowledgeTrace: RetrievalStep[] = [...trace];
      let rewriteResult: QueryRewriteResult | undefined;

      const kbResponse = await knowledgeBaseSearch({
        query: userMessage,
        signal,
        onProgress: (progress) => {
          emit({
            type: "tool_progress",
            progress: { ...progress, callId: kbCall.id },
          });

          if (progress.message === "Running hybrid retrieval (sparse + dense)") {
            emitRagStep(
              makeStep(
                "searching",
                "Searching",
                "Running hybrid retrieval across the internal knowledge base.",
              ),
            );
          }

          if (progress.message === "Hybrid retrieval degraded to dense-only retrieval") {
            emitRagStep(
              makeStep(
                "searching",
                "Searching",
                "Hybrid retrieval is unavailable, falling back to dense-only retrieval.",
              ),
            );
          }

          if (progress.message === "Calling Jina rerank") {
            emitRagStep(
              makeStep(
                "reranking",
                "Reranking",
                "Refining the retrieved documents with the reranker.",
              ),
            );
          }

          if (progress.message === "Jina rerank failed, keeping the local hybrid ranking") {
            emitRagStep(
              makeStep(
                "reranking",
                "Reranking",
                "Reranking was unavailable, so the local ranking was kept.",
              ),
            );
          }
        },
      });

      retrievalDocuments.push(...kbResponse.documents);
      knowledgeTrace.push(
        makeStep(
          "searching",
          "Searching",
          `Knowledge-base ${kbResponse.strategy} search completed with ${kbResponse.documents.length} candidate(s).`,
          {
            strategy: kbResponse.strategy,
          },
        ),
      );
      emitRagStep(
        makeStep(
          "searching",
          "Searching",
          `Retrieved ${kbResponse.documents.length} candidate document(s) from the knowledge base.`,
          {
            strategy: kbResponse.strategy,
            candidates: kbResponse.documents.length,
          },
        ),
      );

      knowledgeTrace.push(
        kbResponse.reranked
          ? makeStep("reranking", "Reranking", "Jina API reranking completed.")
          : makeStep("reranking", "Reranking", "Jina reranking unavailable, using local ranking instead."),
      );

      const gradeCall = createToolCall("knowledgeBaseSearch", "grade", {
        query: userMessage,
        candidates: kbResponse.documents.length,
      });
      emit({ type: "tool_started", toolCall: gradeCall });
      emit({
        type: "tool_progress",
        progress: {
          callId: gradeCall.id,
          tool: "knowledgeBaseSearch",
          message: "Grading -> grade_documents",
          detail: "Checking whether the retrieved documents are sufficient to answer.",
        },
      });
      emitRagStep(
        makeStep(
          "grading",
          "Grading",
          "Checking whether the retrieved documents are sufficient to answer the question.",
        ),
      );

      let grade = assessKnowledgeBaseRetrieval({
        query: userMessage,
        documents: kbResponse.documents,
      });

      let rewrittenQuery = userMessage;
      let rewrittenDocs = kbResponse.documents;
      const rewriteTrace = [...knowledgeTrace];

      if (grade.decision === "rewrite") {
        const strategy = chooseRewriteStrategy(0);
        const rewriteCall = createToolCall("knowledgeBaseSearch", "rewrite", {
          strategy,
          query: userMessage,
        });
        emit({ type: "tool_started", toolCall: rewriteCall });
        emit({
          type: "tool_progress",
          progress: {
            callId: rewriteCall.id,
            tool: "knowledgeBaseSearch",
            message: "Rewriting -> " + strategy,
            detail: "Rewriting the knowledge-base query because the retrieved documents are weak.",
          },
        });
        emitRagStep(
          makeStep(
            "grading",
            "Grading",
            "The first retrieval was too weak, so the query will be rewritten before searching again.",
            {
              decision: grade.decision,
              reason: grade.reason,
            },
          ),
        );
        emitRagStep(
          makeStep(
            "rewriting",
            "Rewriting",
            `Rewriting the knowledge-base query with the ${strategy} strategy.`,
          ),
        );

        const rewrite = await provider.rewriteQuery({
          userMessage,
          retrievalContext: kbResponse.documents,
          strategyHint: strategy,
          signal,
        });
        rewriteResult = rewrite;
        rewrittenQuery = rewrite.query;
        rewriteTrace.push(
          makeStep("rewriting", "Rewriting", rewrite.reason, {
            mode: rewrite.mode,
            query: rewrite.query,
          }),
        );
        emitRagStep(
          makeStep("rewriting", "Rewriting", rewrite.reason, {
            mode: rewrite.mode,
            query: rewrite.query,
          }),
        );
        emitRagStep(
          makeStep(
            "searching",
            "Searching",
            "Searching the knowledge base again with the rewritten query.",
            {
              query: rewrittenQuery,
            },
          ),
        );

        const rewrittenResponse = await knowledgeBaseSearch({
          query: rewrittenQuery,
          signal,
        });
        rewrittenDocs = rewrittenResponse.documents;
        retrievalDocuments.splice(0, retrievalDocuments.length, ...rewrittenDocs);
        rewriteTrace.push(
          makeStep(
            "searching",
            "Searching",
            `Expanded retrieval returned ${rewrittenDocs.length} candidate(s).`,
            {
              strategy: rewrittenResponse.strategy,
              candidates: rewrittenDocs.length,
            },
          ),
        );
        emitRagStep(
          makeStep(
            "searching",
            "Searching",
            `Expanded retrieval returned ${rewrittenDocs.length} candidate document(s).`,
            {
              strategy: rewrittenResponse.strategy,
              candidates: rewrittenDocs.length,
            },
          ),
        );
        grade = assessKnowledgeBaseRetrieval({
          query: userMessage,
          documents: rewrittenDocs,
        });
      }

      emitRagStep(
        makeStep(
          "grading",
          "Grading",
          grade.decision === "answer"
            ? "The retrieved documents are strong enough to answer directly."
            : "The retrieved documents are still weak, so the assistant will answer conservatively.",
          {
            decision: grade.decision,
            reason: grade.reason,
          },
        ),
      );

      const kbResult: ToolResult = {
        callId: kbCall.id,
        tool: "knowledgeBaseSearch",
        phase: "search",
        status: rewrittenDocs.length > 0 ? "success" : "empty",
        summary: `Knowledge-base retrieval completed with ${rewrittenDocs.length} candidate(s); grading decision: ${grade.decision}.`,
        payload: rewrittenDocs,
        provider: "knowledge-base",
        keptCount: rewrittenDocs.length,
        detail: JSON.stringify({
          decisionSource: grade.decisionSource,
          queryTerms: grade.queryTerms,
          topDocument: grade.topDocument,
          coverageRatio: grade.coverageRatio,
          relevantDocumentCount: grade.relevantDocumentCount,
          topGap: grade.topGap,
          reason: grade.reason,
          queryUsed: rewrittenQuery,
        }),
        trace: [
          ...rewriteTrace,
          makeStep("grading", "Grading", grade.reason, {
            decisionSource: grade.decisionSource,
            queryTerms: grade.queryTerms,
            topDocument: grade.topDocument,
            coverageRatio: grade.coverageRatio,
            relevantDocumentCount: grade.relevantDocumentCount,
            topGap: grade.topGap,
            decision: grade.decision,
          }),
          makeStep("completed", "Completed", "Knowledge-base retrieval finished."),
        ],
      };
      toolResults.push(kbResult);
      emit({ type: "tool_result", toolResult: kbResult });
      runTrace = {
        route: routed,
        originalQuery: userMessage,
        finalQuery: rewrittenQuery,
        searchStrategy: kbResponse.strategy,
        grading: grade,
        rewrite: rewriteResult,
        retrievedDocuments: toTraceDocuments(rewrittenDocs),
        steps: kbResult.trace ?? [],
      };

      if (shouldSupplementKnowledgeWithWeb(userMessage)) {
        const decision = await provider.decideWebSearchToolCall({
          userMessage,
          recentConversation,
          memorySummary: nextMemorySummary,
          signal,
        });

        if (decision.status === "call" && decision.query) {
          const aborted = await runWebSearch(
            {
              status: "call",
              query: decision.query,
              reason: decision.reason,
            },
            "supplemental",
          );
          if (aborted) {
            return aborted;
          }
        }
      }
    }

    if (routed === "web") {
      const decision = await provider.decideWebSearchToolCall({
        userMessage,
        recentConversation,
        memorySummary: nextMemorySummary,
        signal,
      });

      if (decision.status !== "call" || !decision.query) {
        const skippedResult: ToolResult = {
          callId: crypto.randomUUID(),
          tool: "searchWeb",
          phase: "search",
          status: "skipped",
          summary:
            decision.status === "disabled"
              ? "web_search is unavailable for the current model endpoint."
              : "Model chose not to call web_search for this request.",
          payload: [],
          detail: JSON.stringify(decision),
          trace: [
            ...trace,
            makeStep("completed", "Completed", decision.reason, {
              status: decision.status,
            }),
          ],
        };
        toolResults.push(skippedResult);
        emit({ type: "tool_result", toolResult: skippedResult });
      } else {
        const aborted = await runWebSearch(
          {
            status: "call",
            query: decision.query,
            reason: decision.reason,
          },
          "requested",
        );
        if (aborted) {
          return aborted;
        }
      }
    }

    if (false && routed === "web") {
      // Legacy web rewrite path intentionally disabled.
    }
    const answerResult = await streamAssistantWithContinuations({
      provider,
      userMessage,
      recentConversation,
      memorySummary: nextMemorySummary,
      searchResults,
      pageContents,
      retrievalDocuments,
      toolResults,
      emit,
      signal,
      onTextUpdate: (text) => {
        assistantText = text;
      },
    });
    assistantText = answerResult.assistantText;

    return {
      sessionId,
      runId,
      userMessage,
      conversation,
      recentConversation,
      memorySummary: nextMemorySummary,
      toolResults,
      taskCategory,
      status: "completed",
      assistantText,
      trace: runTrace,
    };
  } catch (error) {
    if (isAbortError(error, signal)) {
      emit({
        type: "assistant_aborted",
        runId,
        message: "Current answer was aborted.",
      });
      return abortedState();
    }

    if (error instanceof SearchToolError) {
      const failedTool =
        routed === "weather"
          ? "weatherLookup"
          : routed === "knowledge-base"
            ? "knowledgeBaseSearch"
            : "searchWeb";
      const failedPhase = routed === "weather" ? "weather" : "search";
      const failedSummary =
        routed === "weather"
          ? "Weather lookup failed, so this turn falls back to a direct answer."
          : routed === "knowledge-base"
            ? "Knowledge-base retrieval failed, so this turn falls back to a direct answer."
            : "Web retrieval failed, so this turn falls back to a direct answer.";
      const failedTraceDetail =
        routed === "weather"
          ? "Weather lookup stopped with an error."
          : routed === "knowledge-base"
            ? "Knowledge-base retrieval stopped with an error."
            : "Web retrieval stopped with an error.";
      const failedResult: ToolResult = {
        callId: crypto.randomUUID(),
        tool: failedTool,
        phase: failedPhase,
        status: "error",
        summary: failedSummary,
        payload: [],
        provider: error.provider,
        errorType: error.type,
        detail: error.detail ?? error.message,
        trace: [
          makeStep("completed", "Completed", failedTraceDetail, {
            error: error.message,
            route: routed,
          }),
        ],
      };
      toolResults.push(failedResult);
      emit({ type: "tool_result", toolResult: failedResult });

      const answerResult = await streamAssistantWithContinuations({
        provider,
        userMessage,
        recentConversation,
        memorySummary: nextMemorySummary,
        searchResults,
        pageContents,
        retrievalDocuments,
        toolResults,
        emit,
        signal,
        onTextUpdate: (text) => {
          assistantText = text;
        },
      });
      assistantText = answerResult.assistantText;

      return {
        sessionId,
        runId,
        userMessage,
        conversation,
        recentConversation,
        memorySummary: nextMemorySummary,
        toolResults,
        taskCategory,
        status: "completed",
        assistantText,
        trace: runTrace,
      };
    }

    throw error;
  }
};

