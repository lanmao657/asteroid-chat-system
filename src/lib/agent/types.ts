export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export type SearchProviderName =
  | "tavily"
  | "search-api"
  | "duckduckgo-html"
  | "bing-rss"
  | "knowledge-base"
  | "weather-api";

export type ToolErrorType =
  | "network"
  | "timeout"
  | "http"
  | "parse"
  | "empty"
  | "aborted"
  | "unknown";

export type ToolName =
  | "searchWeb"
  | "fetchWebPage"
  | "knowledgeBaseSearch"
  | "weatherLookup";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  evidence: "search-snippet" | "page-content";
  fetchStatus: "pending" | "fetched" | "skipped" | "failed";
  skipReason?: string;
  rankingSignals?: string[];
  score?: number;
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  content: string;
}

export interface WebSearchResponse {
  status: "success" | "empty";
  provider: SearchProviderName;
  results: WebSearchResultItem[];
}

export interface FetchedPage {
  title: string;
  url: string;
  description: string;
  excerpt: string;
}

export interface KnowledgeBaseDocument {
  id: string;
  title: string;
  source: string;
  url?: string;
  content: string;
  tags: string[];
}

export interface RetrievalDocument {
  id: string;
  title: string;
  source: string;
  content: string;
  url?: string;
  metadata?: Record<string, unknown>;
  scores: {
    sparse?: number;
    dense?: number;
    rrf?: number;
    rerank?: number;
    final: number;
  };
}

export interface WeatherResult {
  location: string;
  summary: string;
  temperatureC: number | null;
  feelsLikeC: number | null;
  humidity: number | null;
  windKph: number | null;
}

export interface QueryRewriteResult {
  mode: "none" | "step-back" | "hyde";
  query: string;
  reason: string;
}

export interface GradeDocumentsResult {
  decision: "answer" | "rewrite";
  averageScore: number;
  reason: string;
}

export interface ToolCall {
  id: string;
  tool: ToolName;
  phase:
    | "route"
    | "search"
    | "grade"
    | "rewrite"
    | "fetch"
    | "rerank"
    | "weather";
  input: Record<string, unknown>;
}

export interface ToolProgress {
  callId: string;
  tool: ToolName;
  message: string;
  provider?: SearchProviderName;
  step?: number;
  totalSteps?: number;
  detail?: string;
}

export interface RetrievalStep {
  stage:
    | "routing"
    | "searching"
    | "grading"
    | "rewriting"
    | "reranking"
    | "fetching"
    | "completed";
  label: string;
  detail: string;
  metadata?: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  tool: ToolName;
  phase: ToolCall["phase"];
  status: "success" | "error" | "empty" | "skipped";
  summary: string;
  payload: SearchResult[] | FetchedPage | FetchedPage[] | RetrievalDocument[] | WeatherResult;
  provider?: SearchProviderName;
  errorType?: ToolErrorType;
  detail?: string;
  keptCount?: number;
  filteredCount?: number;
  skippedCount?: number;
  trace?: RetrievalStep[];
}

export interface AgentState {
  sessionId: string;
  runId: string;
  userMessage: string;
  conversation: ChatMessage[];
  recentConversation: ChatMessage[];
  memorySummary: string;
  toolResults: ToolResult[];
  status: "running" | "completed" | "aborted" | "errored";
  assistantText: string;
}

export interface SummarizeConversationInput {
  existingSummary: string;
  messagesToSummarize: ChatMessage[];
  signal?: AbortSignal;
}

export interface StreamAnswerInput {
  userMessage: string;
  recentConversation: ChatMessage[];
  memorySummary: string;
  searchResults: SearchResult[];
  pageContents: FetchedPage[];
  retrievalDocuments: RetrievalDocument[];
  toolResults: ToolResult[];
  signal?: AbortSignal;
  onDelta: (delta: string) => void | Promise<void>;
}

export interface DecideWebSearchInput {
  userMessage: string;
  recentConversation: ChatMessage[];
  memorySummary: string;
  signal?: AbortSignal;
}

export interface WebSearchToolDecision {
  status: "call" | "none" | "disabled";
  reason: string;
  query?: string;
}

export type ModelFinishReason = "stop" | "length" | "abort" | "error" | "unknown";

export interface StreamAnswerResult {
  text: string;
  finishReason: ModelFinishReason;
}

export interface RewriteQueryInput {
  userMessage: string;
  retrievalContext: RetrievalDocument[];
  strategyHint?: "step-back" | "hyde";
  signal?: AbortSignal;
}

export interface GradeDocumentsInput {
  userMessage: string;
  retrievalContext: RetrievalDocument[];
  signal?: AbortSignal;
}

export interface LLMProvider {
  readonly id: string;
  readonly label: string;
  summarizeConversation(input: SummarizeConversationInput): Promise<string>;
  streamAnswer(input: StreamAnswerInput): Promise<StreamAnswerResult>;
  rewriteQuery(input: RewriteQueryInput): Promise<QueryRewriteResult>;
  gradeDocuments(input: GradeDocumentsInput): Promise<GradeDocumentsResult>;
  decideWebSearchToolCall(input: DecideWebSearchInput): Promise<WebSearchToolDecision>;
}

export type AgentStreamEvent =
  | {
      type: "run_started";
      runId: string;
      sessionId: string;
    }
  | {
      type: "session";
      sessionId: string;
      provider: string;
    }
  | {
      type: "memory_compacted";
      summary: string;
      message: string;
      degraded: boolean;
    }
  | {
      type: "tool_started";
      toolCall: ToolCall;
    }
  | {
      type: "tool_progress";
      progress: ToolProgress;
    }
  | {
      type: "tool_result";
      toolResult: ToolResult;
    }
  | {
      type: "assistant_started";
    }
  | {
      type: "assistant_delta";
      delta: string;
    }
  | {
      type: "assistant_final";
      message: ChatMessage;
    }
  | {
      type: "assistant_aborted";
      runId: string;
      message: string;
    }
  | {
      type: "error";
      message: string;
    }
  | {
      type: "done";
    };
