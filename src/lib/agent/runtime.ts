import { agentEnv } from "@/lib/agent/env";
import { createProvider } from "@/lib/agent/provider";
import {
  SearchToolError,
  fetchWebPage,
  lookupWeather,
  searchKnowledgeBase,
  searchWeb,
} from "@/lib/agent/tools";
import type {
  AgentState,
  AgentStreamEvent,
  ChatMessage,
  FetchedPage,
  GradeDocumentsResult,
  LLMProvider,
  ModelFinishReason,
  RetrievalDocument,
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

type RouteTarget = "web" | "knowledge-base" | "weather" | "none";

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
const KNOWLEDGE_SIGNALS = ["知识库", "文档", "内部", "产品", "企业", "设计", "kb", "docs"];

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

const buildSearchSummary = (
  results: SearchResult[],
  filteredResults: SearchResult[],
  provider: string,
) => {
  if (results.length === 0) {
    return {
      status: "empty" as const,
      summary: `检索已完成，但 ${provider} 没有保留到足够相关的结果。`,
    };
  }

  return {
    status: "success" as const,
    summary: `检索完成，保留 ${results.length} 条结果，过滤 ${filteredResults.length} 条来源。`,
  };
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

  const abortedState = (): AgentState => ({
    sessionId,
    runId,
    userMessage,
    conversation,
    recentConversation,
    memorySummary: nextMemorySummary,
    toolResults,
    status: "aborted",
    assistantText,
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
          message: "已压缩旧消息并保留最近上下文。",
          degraded: false,
        });
      } catch (error) {
        if (isAbortError(error, signal)) {
          emit({
            type: "assistant_aborted",
            runId,
            message: "已停止当前回答。",
          });
          return abortedState();
        }

        emit({
          type: "memory_compacted",
          summary: nextMemorySummary,
          message: "旧消息摘要失败，本轮继续沿用现有摘要。",
          degraded: true,
        });
      }
    }

    const routed = routeRetrieval(userMessage);
    const routeCall = createToolCall("searchWeb", "route", { userMessage, route: routed });
    emit({ type: "tool_started", toolCall: routeCall });
    emit({
      type: "tool_progress",
      progress: {
        callId: routeCall.id,
        tool: "searchWeb",
        message: `Routing -> ${routed}`,
        detail: "根据问题类型在天气、知识库和网页检索之间选择最合适的工具。",
      },
    });

    const trace: RetrievalStep[] = [
      makeStep("routing", "Routing", `本轮选择 ${routed} 路由`, {
        route: routed,
      }),
    ];

    if (routed === "weather") {
      const weatherCall = createToolCall("weatherLookup", "weather", { query: userMessage });
      emit({ type: "tool_started", toolCall: weatherCall });
      emit({
        type: "tool_progress",
        progress: {
          callId: weatherCall.id,
          tool: "weatherLookup",
          message: "Searching -> Weather API",
          detail: "正在查询天气服务。",
        },
      });

      const location = userMessage
        .replace(/.*?(天气|weather|forecast|temperature)/i, "")
        .replace(/[？?。!！]/g, "")
        .trim() || "Shanghai";
      const weather = await weatherLookup({ location, signal });

      const weatherResult: ToolResult = {
        callId: weatherCall.id,
        tool: "weatherLookup",
        phase: "weather",
        status: "success",
        summary: `天气查询完成：${weather.location}，${weather.summary}`,
        payload: weather,
        provider: "weather-api",
        trace: [
        ...trace,
          makeStep(
            "searching",
            "Searching",
            `查询天气：${weather.location}`,
            weather as unknown as Record<string, unknown>,
          ),
          makeStep("completed", "Completed", "天气结果已经可用于回答。"),
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

      const kbResponse = await knowledgeBaseSearch({
        query: userMessage,
        signal,
        onProgress: (progress) =>
          emit({
            type: "tool_progress",
            progress: { ...progress, callId: kbCall.id },
          }),
      });

      retrievalDocuments.push(...kbResponse.documents);
      const kbTrace = [
        ...trace,
        makeStep(
          "searching",
          "Searching",
          `知识库 ${kbResponse.strategy} 检索完成，召回 ${kbResponse.documents.length} 条候选`,
          {
            strategy: kbResponse.strategy,
          },
        ),
        kbResponse.reranked
          ? makeStep("reranking", "Reranking", "Jina API 精排已完成。")
          : makeStep("reranking", "Reranking", "未启用或未成功执行外部精排，沿用本地排序。"),
      ];

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
          detail: "正在判断召回文档是否足够支撑回答。",
        },
      });

      let grade = await provider.gradeDocuments({
        userMessage,
        retrievalContext: kbResponse.documents,
        signal,
      });

      let rewrittenQuery = userMessage;
      let rewrittenDocs = kbResponse.documents;
      const rewriteTrace = [...kbTrace];

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
            message: `Rewriting -> ${strategy}`,
            detail: "正在根据低相关性结果重写查询。",
          },
        });

        const rewrite = await provider.rewriteQuery({
          userMessage,
          retrievalContext: kbResponse.documents,
          strategyHint: strategy,
          signal,
        });
        rewrittenQuery = rewrite.query;
        rewriteTrace.push(
          makeStep("rewriting", "Rewriting", rewrite.reason, {
            mode: rewrite.mode,
            query: rewrite.query,
          }),
        );

        const rewrittenResponse = await knowledgeBaseSearch({
          query: rewrittenQuery,
          signal,
        });
        rewrittenDocs = rewrittenResponse.documents;
        retrievalDocuments.splice(0, retrievalDocuments.length, ...rewrittenDocs);
        grade = await provider.gradeDocuments({
          userMessage,
          retrievalContext: rewrittenDocs,
          signal,
        });
      }

      const kbResult: ToolResult = {
        callId: kbCall.id,
        tool: "knowledgeBaseSearch",
        phase: "search",
        status: rewrittenDocs.length > 0 ? "success" : "empty",
        summary: `知识库检索完成，保留 ${rewrittenDocs.length} 条候选，评分结论：${grade.decision}`,
        payload: rewrittenDocs,
        provider: "knowledge-base",
        keptCount: rewrittenDocs.length,
        detail: JSON.stringify({
          averageScore: grade.averageScore,
          reason: grade.reason,
          queryUsed: rewrittenQuery,
        }),
        trace: [
          ...rewriteTrace,
          makeStep("grading", "Grading", grade.reason, {
            averageScore: grade.averageScore,
            decision: grade.decision,
          }),
          makeStep("completed", "Completed", "知识库检索链路结束。"),
        ],
      };
      toolResults.push(kbResult);
      emit({ type: "tool_result", toolResult: kbResult });
    }

    if (routed === "web") {
      let activeQuery = userMessage;
      let finalGrade: GradeDocumentsResult | null = null;

      for (let rewriteTurn = 0; rewriteTurn < 2; rewriteTurn += 1) {
        const searchCall = createToolCall("searchWeb", "search", { query: activeQuery });
        emit({ type: "tool_started", toolCall: searchCall });
        emit({
          type: "tool_progress",
          progress: {
            callId: searchCall.id,
            tool: "searchWeb",
            message: "Searching -> Web",
            detail: `当前查询：${activeQuery}`,
          },
        });

        const response = await search({
          query: activeQuery,
          signal,
          onProgress: (progress) =>
            emit({
              type: "tool_progress",
              progress: { ...progress, callId: searchCall.id },
            }),
        });

        searchResults.splice(0, searchResults.length, ...response.results);
        const searchSummary = buildSearchSummary(
          response.results,
          response.filteredResults,
          response.provider,
        );
        const webTrace: RetrievalStep[] = [
          ...trace,
          makeStep("searching", "Searching", searchSummary.summary, {
            provider: response.provider,
            query: activeQuery,
          }),
        ];

        pageContents.splice(0, pageContents.length);
        for (const [index, result] of response.results
          .slice(0, agentEnv.fetchMaxPages)
          .entries()) {
          const fetchCall = createToolCall("fetchWebPage", "fetch", { url: result.url });
          emit({ type: "tool_started", toolCall: fetchCall });
          emit({
            type: "tool_progress",
            progress: {
              callId: fetchCall.id,
              tool: "fetchWebPage",
              message: `Fetching -> ${index + 1}/${Math.min(
                response.results.length,
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
                message: "已停止当前回答。",
              });
              return abortedState();
            }
            result.fetchStatus = "failed";
          }
        }

        retrievalDocuments.splice(
          0,
          retrievalDocuments.length,
          ...toRetrievalDocumentsFromSearch(response.results, pageContents),
        );

        const gradeCall = createToolCall("searchWeb", "grade", {
          query: activeQuery,
          candidates: retrievalDocuments.length,
        });
        emit({ type: "tool_started", toolCall: gradeCall });
        emit({
          type: "tool_progress",
          progress: {
            callId: gradeCall.id,
            tool: "searchWeb",
            message: "Grading -> grade_documents",
            detail: "正在判断网页候选是否足够相关。",
          },
        });

        finalGrade = await provider.gradeDocuments({
          userMessage,
          retrievalContext: retrievalDocuments,
          signal,
        });

        if (finalGrade.decision === "answer" || rewriteTurn === 1) {
          const webResult: ToolResult = {
            callId: searchCall.id,
            tool: "searchWeb",
            phase: "search",
            status: searchSummary.status,
            summary: `网页检索完成，${finalGrade.reason}`,
            payload: response.results,
            provider: response.provider,
            keptCount: response.results.length,
            filteredCount: response.filteredResults.length,
            detail: JSON.stringify({
              queryUsed: activeQuery,
              averageScore: finalGrade.averageScore,
              decision: finalGrade.decision,
            }),
            trace: [
              ...webTrace,
              makeStep("grading", "Grading", finalGrade.reason, {
                averageScore: finalGrade.averageScore,
                decision: finalGrade.decision,
              }),
              makeStep("completed", "Completed", "网页检索链路结束。"),
            ],
          };
          toolResults.push(webResult);
          emit({ type: "tool_result", toolResult: webResult });
          break;
        }

        const strategy = chooseRewriteStrategy(rewriteTurn);
        const rewriteCall = createToolCall("searchWeb", "rewrite", {
          query: activeQuery,
          strategy,
        });
        emit({ type: "tool_started", toolCall: rewriteCall });
        emit({
          type: "tool_progress",
          progress: {
            callId: rewriteCall.id,
            tool: "searchWeb",
            message: `Rewriting -> ${strategy}`,
            detail: "候选相关性不足，准备触发重写检索。",
          },
        });

        const rewrite = await provider.rewriteQuery({
          userMessage,
          retrievalContext: retrievalDocuments,
          strategyHint: strategy,
          signal,
        });
        activeQuery = rewrite.query;

        const rewriteResult: ToolResult = {
          callId: rewriteCall.id,
          tool: "searchWeb",
          phase: "rewrite",
          status: "success",
          summary: `查询已重写为 ${rewrite.mode} 模式`,
          payload: [],
          provider: "search-api",
          detail: JSON.stringify(rewrite),
          trace: [
            ...trace,
            makeStep("rewriting", "Rewriting", rewrite.reason, {
              mode: rewrite.mode,
              query: rewrite.query,
            }),
          ],
        };
        toolResults.push(rewriteResult);
        emit({ type: "tool_result", toolResult: rewriteResult });
      }
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
      status: "completed",
      assistantText,
    };
  } catch (error) {
    if (isAbortError(error, signal)) {
      emit({
        type: "assistant_aborted",
        runId,
        message: "已停止当前回答。",
      });
      return abortedState();
    }

    if (error instanceof SearchToolError) {
      const failedResult: ToolResult = {
        callId: crypto.randomUUID(),
        tool: "searchWeb",
        phase: "search",
        status: "error",
        summary: "检索链路失败，本轮退回到直接回答。",
        payload: [],
        provider: error.provider,
        errorType: error.type,
        detail: error.detail ?? error.message,
        trace: [
          makeStep("completed", "Completed", "检索链路异常结束。", {
            error: error.message,
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
        status: "completed",
        assistantText,
      };
    }

    throw error;
  }
};
