export type MessageRole = "user" | "assistant" | "tool";

export type ToolName = "searchWeb" | "fetchWebPage";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  name?: string;
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  evidence: "search-snippet" | "page-content";
  fetchStatus: "pending" | "fetched" | "skipped" | "failed";
  skipReason?: string;
  rankingSignals?: string[];
}

export type SearchProviderName = "search-api" | "duckduckgo-html" | "bing-rss";

export type ToolErrorType =
  | "network"
  | "timeout"
  | "http"
  | "parse"
  | "empty"
  | "unknown";

export interface FetchedPage {
  title: string;
  url: string;
  description: string;
  excerpt: string;
}

export interface ToolCall {
  id: string;
  tool: ToolName;
  input: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  tool: ToolName;
  status: "success" | "error" | "empty" | "skipped" | "filtered";
  summary: string;
  payload: SearchResult[] | FetchedPage | FetchedPage[];
  provider?: SearchProviderName;
  errorType?: ToolErrorType;
  userMessage?: string;
  detail?: string;
  skippedCount?: number;
  filteredCount?: number;
  recoverable?: boolean;
  degradationMode?: AgentState["fallbackMode"];
  attempts?: Array<{
    provider: SearchProviderName;
    ok: boolean;
    errorType?: ToolErrorType;
    detail?: string;
  }>;
}

export interface ProviderDecision {
  mode: "respond" | "search";
  rationale: string;
  query?: string;
}

export interface LLMProvider {
  readonly id: string;
  readonly label: string;
  decideNextAction(input: {
    userMessage: string;
    conversation: ChatMessage[];
  }): Promise<ProviderDecision>;
  composeAnswer(input: {
    userMessage: string;
    conversation: ChatMessage[];
    searchResults: SearchResult[];
    pageContents: FetchedPage[];
    toolResults: ToolResult[];
    fallbackMode: AgentState["fallbackMode"];
  }): Promise<string>;
}

export interface AgentState {
  sessionId: string;
  userMessage: string;
  conversation: ChatMessage[];
  decision: ProviderDecision | null;
  searchResults: SearchResult[];
  pageContents: FetchedPage[];
  toolResults: ToolResult[];
  assistantText: string;
  fallbackMode: "none" | "background" | "snippet-only";
}

export type AgentStreamEvent =
  | {
      type: "session";
      sessionId: string;
      provider: string;
    }
  | {
      type: "tool_started";
      toolCall: ToolCall;
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
      type: "error";
      message: string;
    }
  | {
      type: "done";
    };
