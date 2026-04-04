import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import { agentEnv } from "@/lib/agent/env";
import { createProvider } from "@/lib/agent/provider";
import { fetchWebPage, SearchToolError, searchWeb } from "@/lib/agent/tools";
import type {
  AgentState,
  AgentStreamEvent,
  ChatMessage,
  FetchedPage,
  LLMProvider,
  ProviderDecision,
  SearchResult,
  ToolCall,
  ToolResult,
} from "@/lib/agent/types";

const overwriteReducer = <T>(_: T, right: T) => right;
const appendReducer = <T>(left: T[], right: T[]) => left.concat(right);

const AgentStateAnnotation = Annotation.Root({
  sessionId: Annotation<string>({
    default: () => "",
    reducer: overwriteReducer,
  }),
  userMessage: Annotation<string>({
    default: () => "",
    reducer: overwriteReducer,
  }),
  conversation: Annotation<ChatMessage[]>({
    default: () => [],
    reducer: overwriteReducer,
  }),
  decision: Annotation<ProviderDecision | null>({
    default: () => null,
    reducer: overwriteReducer,
  }),
  searchResults: Annotation<SearchResult[]>({
    default: () => [],
    reducer: overwriteReducer,
  }),
  pageContents: Annotation<FetchedPage[]>({
    default: () => [],
    reducer: overwriteReducer,
  }),
  toolResults: Annotation<ToolResult[]>({
    default: () => [],
    reducer: appendReducer,
  }),
  assistantText: Annotation<string>({
    default: () => "",
    reducer: overwriteReducer,
  }),
  fallbackMode: Annotation<AgentState["fallbackMode"]>({
    default: () => "none",
    reducer: overwriteReducer,
  }),
});

type RuntimeDependencies = {
  provider: LLMProvider;
  search: typeof searchWeb;
  fetchPage: typeof fetchWebPage;
};

const chunkText = (value: string) => value.match(/[\s\S]{1,90}/g) ?? [value];

const createToolCall = (
  tool: ToolCall["tool"],
  input: Record<string, unknown>,
): ToolCall => ({
  id: crypto.randomUUID(),
  tool,
  input,
});

const getGraph = (
  deps: RuntimeDependencies,
  emit: (event: AgentStreamEvent) => void,
) => {
  const graph = new StateGraph(AgentStateAnnotation)
    .addNode("decide", async (state: AgentState) => {
      const decision = await deps.provider.decideNextAction({
        userMessage: state.userMessage,
        conversation: state.conversation,
      });

      return { decision };
    })
    .addNode("search", async (state: AgentState) => {
      if (state.decision?.mode !== "search" || !state.decision.query) {
        return {
          searchResults: [],
          toolResults: [],
          fallbackMode: "none" as const,
        };
      }

      const toolCall = createToolCall("searchWeb", {
        query: state.decision.query,
      });

      emit({ type: "tool_started", toolCall });

      try {
        const searchResponse = await deps.search(state.decision.query);
        const failedAttempts = searchResponse.attempts.filter((attempt) => !attempt.ok);
        const attemptsSummary =
          failedAttempts.length > 0 ? `，期间自动回退或重试了 ${failedAttempts.length} 次` : "";
        const usedFallback = searchResponse.provider !== "search-api";
        const emptyResult = searchResponse.results.length === 0;

        const toolResult: ToolResult = {
          callId: toolCall.id,
          tool: "searchWeb",
          status: emptyResult ? "empty" : "success",
          summary: emptyResult
            ? `实时检索已完成，但当前没有保留到足够相关的结果${attemptsSummary}。`
            : `保留 ${searchResponse.results.length} 条高相关结果，过滤 ${searchResponse.filteredResults.length} 条明确受限来源${attemptsSummary}。`,
          payload: searchResponse.results,
          provider: searchResponse.provider,
          userMessage: emptyResult
            ? "这次实时检索结果相关性不足，我会继续给你一版背景回答。"
            : usedFallback
              ? "主实时检索未命中可用结果，已切换备用搜索源并完成筛选。"
              : "实时检索已经完成，并按相关性完成了筛选。",
          filteredCount: searchResponse.filteredResults.length,
          recoverable: emptyResult,
          degradationMode: emptyResult ? "background" : "none",
          attempts: searchResponse.attempts,
        };

        emit({ type: "tool_result", toolResult });

        return {
          searchResults: searchResponse.results,
          toolResults: [toolResult],
          fallbackMode: emptyResult ? ("background" as const) : ("none" as const),
        };
      } catch (error) {
        const searchError =
          error instanceof SearchToolError
            ? error
            : new SearchToolError(
                "Search request failed.",
                "unknown",
                "search-api",
                "搜索工具暂时不可用，请稍后重试。",
                error instanceof Error ? error.message : String(error),
              );

        const toolResult: ToolResult = {
          callId: toolCall.id,
          tool: "searchWeb",
          status: searchError.type === "empty" ? "empty" : "error",
          summary: searchError.userMessage,
          payload: [],
          provider: searchError.provider,
          errorType: searchError.type,
          userMessage: `${searchError.userMessage} 系统将继续提供一版背景回答。`,
          detail: searchError.detail ?? searchError.message,
          recoverable: true,
          degradationMode: "background",
        };

        emit({ type: "tool_result", toolResult });

        return {
          searchResults: [],
          toolResults: [toolResult],
          fallbackMode: "background" as const,
        };
      }
    })
    .addNode("fetch-pages", async (state: AgentState) => {
      const targets = state.searchResults.slice(0, agentEnv.fetchMaxPages);
      if (!targets.length) {
        return {
          pageContents: [],
          toolResults: [],
          fallbackMode: state.fallbackMode,
        };
      }

      const toolResults: ToolResult[] = [];
      const pageContents: FetchedPage[] = [];
      let fallbackMode = state.fallbackMode;

      for (const result of targets) {
        if (result.fetchStatus === "skipped") {
          const toolResult: ToolResult = {
            callId: crypto.randomUUID(),
            tool: "fetchWebPage",
            status: "skipped",
            summary: `已跳过 ${result.domain}，因为该来源命中了明确的站点限制策略。`,
            payload: [],
            userMessage: "部分结果因站点限制被跳过了正文抓取。",
            detail: result.skipReason,
            skippedCount: 1,
            recoverable: true,
            degradationMode: "snippet-only",
          };
          emit({ type: "tool_result", toolResult });
          toolResults.push(toolResult);
          fallbackMode = "snippet-only";
          continue;
        }

        const toolCall = createToolCall("fetchWebPage", { url: result.url });
        emit({ type: "tool_started", toolCall });

        try {
          const page = await deps.fetchPage(result.url);
          pageContents.push(page);

          const toolResult: ToolResult = {
            callId: toolCall.id,
            tool: "fetchWebPage",
            status: "success",
            summary: `已抓取页面：${page.title}`,
            payload: page,
            userMessage: `已抓取页面：${page.title}`,
            degradationMode: fallbackMode,
          };

          toolResults.push(toolResult);
          emit({ type: "tool_result", toolResult });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown page fetch error";
          const toolResult: ToolResult = {
            callId: toolCall.id,
            tool: "fetchWebPage",
            status: "error",
            summary: "页面抓取失败了，已跳过这个来源。",
            payload: [],
            errorType: "network",
            userMessage: "页面抓取失败了，这轮回答会改为基于搜索摘要整理。",
            detail: message,
            recoverable: true,
            degradationMode: "snippet-only",
          };
          emit({ type: "tool_result", toolResult });
          toolResults.push(toolResult);
          fallbackMode = "snippet-only";
        }
      }

      return {
        pageContents,
        toolResults,
        fallbackMode: pageContents.length > 0 ? state.fallbackMode : fallbackMode,
      };
    })
    .addNode("compose", async (state: AgentState) => {
      const assistantText = await deps.provider.composeAnswer({
        userMessage: state.userMessage,
        conversation: state.conversation,
        searchResults: state.searchResults,
        pageContents: state.pageContents,
        toolResults: state.toolResults,
        fallbackMode: state.fallbackMode,
      });

      emit({ type: "assistant_started" });
      for (const delta of chunkText(assistantText)) {
        emit({ type: "assistant_delta", delta });
      }

      return { assistantText };
    })
    .addEdge(START, "decide")
    .addConditionalEdges("decide", (state: AgentState) =>
      state.decision?.mode === "search" ? "search" : "compose",
    )
    .addEdge("search", "fetch-pages")
    .addEdge("fetch-pages", "compose")
    .addEdge("compose", END);

  return graph.compile();
};

export const runAgentTurn = async ({
  sessionId,
  userMessage,
  conversation,
  emit,
  dependencies,
}: {
  sessionId: string;
  userMessage: string;
  conversation: ChatMessage[];
  emit: (event: AgentStreamEvent) => void;
  dependencies?: Partial<RuntimeDependencies>;
}) => {
  const deps: RuntimeDependencies = {
    provider: dependencies?.provider ?? createProvider(),
    search: dependencies?.search ?? searchWeb,
    fetchPage: dependencies?.fetchPage ?? fetchWebPage,
  };

  emit({
    type: "session",
    sessionId,
    provider: deps.provider.label,
  });

  const graph = getGraph(deps, emit);
  return graph.invoke({
    sessionId,
    userMessage,
    conversation,
    decision: null,
    searchResults: [],
    pageContents: [],
    toolResults: [],
    assistantText: "",
    fallbackMode: "none",
  });
};
