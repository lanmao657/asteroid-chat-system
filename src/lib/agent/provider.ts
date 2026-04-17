import { agentEnv } from "@/lib/agent/env";
import {
  getDirectScriptStyleInstruction,
  isDirectScriptIntent,
  getPresentationStyleInstruction,
} from "@/lib/agent/presentation";
import type {
  ChatMessage,
  DecideWebSearchInput,
  LLMProvider,
  ModelFinishReason,
  QueryRewriteResult,
  RewriteQueryInput,
  StreamAnswerInput,
  SummarizeConversationInput,
  ToolResult,
  WebSearchToolDecision,
} from "@/lib/agent/types";

class ModelRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "ModelRequestError";
  }
}

const clip = (value: string, max: number) => {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, Math.max(0, max - 1))}...`;
};

const normalizeWhitespace = (value: string) =>
  value.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();

const getCurrentDateLabel = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const formatConversation = (conversation: ChatMessage[]) =>
  conversation.map((message) => ({
    role: message.role,
    content: clip(normalizeWhitespace(message.content), 800),
  }));

const formatToolResults = (toolResults: ToolResult[]) =>
  toolResults.map((result) => ({
    tool: result.tool,
    phase: result.phase,
    status: result.status,
    summary: result.summary,
    detail: result.detail ? clip(result.detail, 600) : undefined,
  }));

const extractJsonObject = (value: string) => {
  const fenced = value.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const match = value.match(/\{[\s\S]*\}/);
  return match?.[0]?.trim() ?? value.trim();
};

class MockLLMProvider implements LLMProvider {
  readonly id = "mock";

  readonly label = "Mock Provider";

  async summarizeConversation(input: SummarizeConversationInput) {
    const lines = input.messagesToSummarize
      .slice(-8)
      .map((message) => `${message.role}: ${clip(normalizeWhitespace(message.content), 80)}`);

    return [
      input.existingSummary ? `已有摘要：${clip(input.existingSummary, 120)}` : "",
      "历史对话摘要：",
      ...lines,
    ]
      .filter(Boolean)
      .join("\n");
  }

  async rewriteQuery(input: RewriteQueryInput): Promise<QueryRewriteResult> {
    const mode = input.strategyHint ?? "step-back";
    if (mode === "hyde") {
      return {
        mode,
        query: `${input.userMessage} 关键事实 参考资料`,
        reason: "使用 HyDE 风格扩展查询，补充更容易命中的语义线索。",
      };
    }

    return {
      mode,
      query: `${input.userMessage} 核心概念 背景 原理`,
      reason: "使用 Step-Back 风格重写，把问题提升到更稳定的抽象层。",
    };
  }

  async decideWebSearchToolCall(
    input: DecideWebSearchInput,
  ): Promise<WebSearchToolDecision> {
    const normalized = input.userMessage.toLowerCase();
    const needsWebSearch =
      /latest|recent|today|current|news|price|version|policy|result|score/.test(
        normalized,
      ) || /最新|实时|新闻|价格|版本|政策|结果|比分|官网/.test(input.userMessage);

    if (!needsWebSearch) {
      return {
        status: "none",
        reason: "Mock provider skipped web_search.",
      };
    }

    return {
      status: "call",
      query: input.userMessage,
      reason: "Mock provider requested web_search.",
    };
  }

  async streamAnswer(input: StreamAnswerInput) {
    const text = [
      "这是企业知识助手的 mock provider 流式回答。",
      input.memorySummary ? `记忆摘要：${clip(input.memorySummary, 120)}` : "",
      input.retrievalDocuments.length > 0
        ? `检索到 ${input.retrievalDocuments.length} 条候选来源，并完成企业知识问答所需的可观测处理。`
        : input.searchResults.length > 0
          ? `外部网页搜索命中 ${input.searchResults.length} 条结果，抓取了 ${input.pageContents.length} 个正文来源。`
          : "这轮没有触发外部检索。",
      `当前问题：${clip(normalizeWhitespace(input.userMessage), 160)}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    let built = "";
    for (const part of text.match(/[\s\S]{1,18}/g) ?? [text]) {
      input.signal?.throwIfAborted?.();
      await sleep(10);
      built += part;
      await input.onDelta(part);
    }

    return {
      text: built,
      finishReason: "stop" as const,
    };
  }
}

class OpenAICompatibleProvider implements LLMProvider {
  readonly id = "openai-compatible";

  readonly label = "OpenAI Compatible";

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async summarizeConversation(input: SummarizeConversationInput) {
    return this.generateText(
      [
        {
          role: "system",
          content: [
            "Summarize older chat history for a future assistant turn.",
            "Keep user goals, constraints, decisions, unresolved questions, and promised follow-ups.",
            "Do not invent facts.",
            "Return plain text under 220 words.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              existingSummary: input.existingSummary,
              messages: formatConversation(input.messagesToSummarize),
            },
            null,
            2,
          ),
        },
      ],
      input.signal,
      260,
    );
  }

  async rewriteQuery(input: RewriteQueryInput): Promise<QueryRewriteResult> {
    const strategyHint = input.strategyHint ?? "step-back";
    const text = await this.generateText(
      [
        {
          role: "system",
          content: [
            "You rewrite retrieval queries for a RAG system.",
            "Return JSON with keys: mode, query, reason.",
            "mode must be one of none, step-back, hyde.",
            "Use step-back to generalize the intent.",
            "Use hyde to create a richer pseudo-answer-style retrieval query.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              userMessage: input.userMessage,
              strategyHint,
              retrievalContext: input.retrievalContext.slice(0, 4).map((document) => ({
                title: document.title,
                source: document.source,
                score: document.scores.final,
              })),
            },
            null,
            2,
          ),
        },
      ],
      input.signal,
      180,
    );

    try {
      const parsed = JSON.parse(extractJsonObject(text)) as QueryRewriteResult;
      if (parsed.mode && parsed.query && parsed.reason) {
        return parsed;
      }
    } catch {}

    return strategyHint === "hyde"
      ? {
          mode: "hyde",
          query: `${input.userMessage} facts examples explanation`,
          reason: "Fallback HyDE rewrite applied.",
        }
      : {
          mode: "step-back",
          query: `${input.userMessage} overview background fundamentals`,
          reason: "Fallback Step-Back rewrite applied.",
        };
  }

  async decideWebSearchToolCall(
    input: DecideWebSearchInput,
  ): Promise<WebSearchToolDecision> {
    const currentDate = getCurrentDateLabel();
    const response = await fetch(
      `${this.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          max_tokens: 120,
          tool_choice: "auto",
          tools: [
            {
              type: "function",
              function: {
                name: "web_search",
                description:
                  "Search the live web for latest information, official sources, prices, policies, releases, and results.",
                parameters: {
                  type: "object",
                  properties: {
                    query: {
                      type: "string",
                      description: "A focused web search query.",
                    },
                  },
                  required: ["query"],
                  additionalProperties: false,
                },
              },
            },
          ],
          messages: [
            {
              role: "system",
              content: [
                "You decide whether a live web search is necessary before answering a user.",
                `Today is ${currentDate}.`,
                "Use the web_search tool only when the user needs current, changing, or official web information.",
                "Examples: latest news, current status, official docs, prices, policy changes, release versions, sports results.",
                "Do not call the tool for stable knowledge, code explanation, or ordinary refactoring questions.",
                "When the user asks for today's or latest news, keep the query concise, use the current date context, and do not invent an old year unless the user explicitly asked for that year.",
                "If web search is unnecessary, do not call any tool.",
              ].join(" "),
            },
            {
              role: "user",
              content: JSON.stringify(
                {
                  userMessage: clip(normalizeWhitespace(input.userMessage), 1_000),
                  memorySummary: clip(input.memorySummary, 300),
                  recentConversation: formatConversation(input.recentConversation).slice(-4),
                },
                null,
                2,
              ),
            },
          ],
        }),
        signal: input.signal,
      },
    ).catch((error) => {
      if (input.signal?.aborted) {
        throw error;
      }

      return null;
    });

    if (!response) {
      return {
        status: "disabled",
        reason: "web_search tool calling is unavailable for the current endpoint.",
      };
    }

    if (!response.ok) {
      return {
        status: "disabled",
        reason: `web_search tool calling is unavailable (${response.status}).`,
      };
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          tool_calls?: Array<{
            function?: {
              name?: string;
              arguments?: string;
            };
          }>;
        };
      }>;
    };

    const toolCall = payload.choices?.[0]?.message?.tool_calls?.find(
      (item) => item.function?.name === "web_search",
    );

    if (!toolCall?.function?.arguments) {
      return {
        status: "none",
        reason: "Model chose not to call web_search.",
      };
    }

    try {
      const parsed = JSON.parse(toolCall.function.arguments) as {
        query?: string;
      };
      const query = normalizeWhitespace(parsed.query ?? "");

      if (!query) {
        return {
          status: "none",
          reason: "Model returned an empty web_search query.",
        };
      }

      return {
        status: "call",
        query,
        reason: "Model requested web_search.",
      };
    } catch {
      return {
        status: "none",
        reason: "Model returned invalid web_search arguments.",
      };
    }
  }

  async streamAnswer(input: StreamAnswerInput) {
    const messages = this.buildAnswerMessages(input);
    let response: Response;

    try {
      response = await fetch(
        `${this.baseUrl.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            temperature: 0.2,
            max_tokens: agentEnv.composeOutputTokenLimit,
            stream: true,
            messages,
          }),
          signal: input.signal,
        },
      );
    } catch (error) {
      if (input.signal?.aborted) {
        throw error;
      }

      return this.completeWithFallback(
        input,
        messages,
        new ModelRequestError(
          "Streaming model request failed before receiving a response.",
          503,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }

    if (!response.ok || !response.body) {
      let detail = "";
      try {
        detail = await response.text();
      } catch {
        detail = "";
      }

      return this.completeWithFallback(
        input,
        messages,
        new ModelRequestError(
          `Model request failed with status ${response.status}`,
          response.status,
          detail,
        ),
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let built = "";
    let finishReason: ModelFinishReason = "unknown";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const parsed = this.parseStreamFrame(frame);
        if (parsed.finishReason) {
          finishReason = parsed.finishReason;
        }

        if (!parsed.delta) {
          continue;
        }

        built += parsed.delta;
        await input.onDelta(parsed.delta);
      }
    }

    const finalText = built.trim();
    if (!finalText) {
      return this.completeWithFallback(
        input,
        messages,
        new ModelRequestError("Model response did not contain content.", 200),
      );
    }

    return {
      text: finalText,
      finishReason,
    };
  }

  private buildAnswerMessages(input: StreamAnswerInput) {
    const presentationStyleInstruction = getPresentationStyleInstruction(
      input.userMessage,
    );
    const directScriptStyleInstruction = getDirectScriptStyleInstruction(
      input.userMessage,
    );
    const isDirectScriptRequest = isDirectScriptIntent(input.userMessage);
    const internalDocuments = input.retrievalDocuments
      .filter((document) => document.url?.startsWith("kb://") || document.source === "internal-doc")
      .slice(0, 6)
      .map((document) => ({
        title: document.title,
        source: document.source,
        url: document.url,
        content: clip(document.content, 420),
        scores: document.scores,
        metadata: {
          documentId: document.metadata?.documentId,
          documentTitle: document.metadata?.documentTitle ?? document.title,
          chunkId: document.metadata?.chunkId,
          chunkIndex: document.metadata?.chunkIndex,
          snippet: document.metadata?.snippet,
          sourceType: document.metadata?.sourceType,
        },
      }));
    const externalDocuments = input.retrievalDocuments
      .filter((document) => !document.url?.startsWith("kb://") && document.source !== "internal-doc")
      .slice(0, 6)
      .map((document) => ({
        title: document.title,
        source: document.source,
        url: document.url,
        content: clip(document.content, 420),
        scores: document.scores,
        metadata: document.metadata,
      }));

    return [
      {
        role: "system" as const,
        content: [
          "You are an internal knowledge and training assistant for a company workspace.",
          "Answer in the same language as the user unless there is a strong reason not to.",
          "Prefer practical, execution-ready answers over generic explanations.",
          "Use memory summary and recent conversation when helpful.",
          "Ground the answer in the highest quality retrieval evidence available.",
          "When evidence is weak, explicitly say uncertainty is high.",
          isDirectScriptRequest
            ? "For this request, use the answer structure: 标准话术, optional 补充说明, optional 来源."
            : "Default answer structure: 结论, 适用范围/场景, 操作步骤或执行建议, 注意事项, 来源.",
          "If the request is simple, keep the sections concise rather than forcing long prose.",
          "When internal knowledge base documents are available, treat them as the primary source of truth for company policy, SOPs, onboarding, and training content.",
          "When both internal documents and live web results are available, separate them explicitly as 内部依据 and 外部参考.",
          "If external information has not yet been reflected in company policy, mark it as 待内部确认.",
          "When live web sources are available, cite the most useful source URLs in the answer.",
          "If web search completed with empty status, say that live search was attempted but current providers did not return enough reliable results.",
          "Do not claim that current news or events do not exist unless the retrieval evidence proves that.",
          "Use only facts that are explicitly supported by the provided retrieval evidence.",
          "Do not output placeholders such as [X], [具体时间], or [提及具体时间].",
          "Do not add unverified process details, branch-specific handling, SLA numbers, ticket numbers, self-service lookup steps, compensation methods, or alternative flows unless the source explicitly contains them.",
          "If a detail is missing from the sources, say so narrowly or keep the wording generic instead of filling in the gap.",
          "If structured presentation is appropriate, prefer clean Markdown headings and lists.",
          "Do not mention internal implementation details unless the user asks.",
          presentationStyleInstruction,
          directScriptStyleInstruction,
        ].join(" "),
      },
      {
        role: "user" as const,
        content: JSON.stringify(
            {
              userMessage: clip(normalizeWhitespace(input.userMessage), 1_600),
              memorySummary: input.memorySummary,
              recentConversation: formatConversation(input.recentConversation),
              internalKnowledgeBaseDocuments: internalDocuments,
              externalReferenceDocuments: externalDocuments,
              searchResults: input.searchResults.slice(0, 4),
              pageContents: input.pageContents.slice(0, 3),
              toolResults: formatToolResults(input.toolResults),
            },
          null,
          2,
        ),
      },
    ];
  }

  private async completeWithFallback(
    input: StreamAnswerInput,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    error: ModelRequestError,
  ) {
    if (input.signal?.aborted) {
      throw error;
    }

    try {
      const text = await this.generateText(
        messages,
        input.signal,
        agentEnv.composeOutputTokenLimit,
      );
      await input.onDelta(text);
      return {
        text,
        finishReason: "stop" as const,
      };
    } catch (fallbackError) {
      if (input.signal?.aborted) {
        throw fallbackError;
      }

      const text = this.buildToolBasedFallbackAnswer(input, error);
      await input.onDelta(text);
      return {
        text,
        finishReason: "error" as const,
      };
    }
  }

  private buildToolBasedFallbackAnswer(
    input: StreamAnswerInput,
    error: ModelRequestError,
  ) {
    const sources = input.retrievalDocuments
      .slice(0, 3)
      .map((document) =>
        document.url
          ? `- ${document.title}: ${document.url}`
          : `- ${document.title} (${document.source})`,
      );

    if (sources.length > 0) {
      return [
        "我已经完成了检索，但上游模型接口当前无法生成完整回答。",
        `接口状态：${error.status}`,
        "你可以先核对这些来源：",
        ...sources,
      ].join("\n");
    }

    return [
      "我尝试完成回答，但上游模型接口当前不可用。",
      `接口状态：${error.status}`,
      "这次没有拿到足够可靠的检索结果，建议稍后重试或更换模型配置。",
    ].join("\n");
  }

  private parseStreamFrame(frame: string): {
    delta: string;
    finishReason: ModelFinishReason | null;
  } {
    const dataLines = frame
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6).trim());

    if (dataLines.length === 0) {
      return { delta: "", finishReason: null };
    }

    const payload = dataLines.join("\n");
    if (payload === "[DONE]") {
      return { delta: "", finishReason: null };
    }

    const parsed = JSON.parse(payload) as {
      choices?: Array<{
        delta?: {
          content?: string | Array<{ type?: string; text?: string }>;
        };
        finish_reason?: string | null;
      }>;
    };

    const finishReason = this.normalizeFinishReason(parsed.choices?.[0]?.finish_reason);
    const content = parsed.choices?.[0]?.delta?.content;
    if (typeof content === "string") {
      return { delta: content, finishReason };
    }

    if (Array.isArray(content)) {
      return {
        delta: content
          .map((item) => (item.type === "text" ? item.text ?? "" : ""))
          .join(""),
        finishReason,
      };
    }

    return { delta: "", finishReason };
  }

  private async generateText(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    signal?: AbortSignal,
    maxTokens = agentEnv.composeOutputTokenLimit,
  ) {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        max_tokens: maxTokens,
        messages,
      }),
      signal,
    });

    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.text();
      } catch {
        detail = "";
      }

      throw new ModelRequestError(
        `Model request failed with status ${response.status}`,
        response.status,
        detail,
      );
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string | null };
        finish_reason?: string | null;
      }>;
    };

    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new ModelRequestError("Model response did not contain content.", 200);
    }

    return content;
  }

  private normalizeFinishReason(value: string | null | undefined): ModelFinishReason | null {
    if (!value) {
      return null;
    }
    if (
      value === "stop" ||
      value === "length" ||
      value === "abort" ||
      value === "error"
    ) {
      return value;
    }

    return "unknown";
  }
}

const createOpenAiProvider = () => {
  if (!agentEnv.openAiCompatApiKey || !agentEnv.openAiModel) {
    throw new Error(
      "OpenAI-compatible API is not configured. Please set OPENAI_COMPAT_API_KEY and OPENAI_MODEL.",
    );
  }

  return new OpenAICompatibleProvider(
    agentEnv.openAiCompatBaseUrl,
    agentEnv.openAiCompatApiKey,
    agentEnv.openAiModel,
  );
};

export const createProvider = (): LLMProvider => {
  if (agentEnv.modelProvider === "mock") {
    return new MockLLMProvider();
  }

  return createOpenAiProvider();
};
