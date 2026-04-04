import { z } from "zod";

import { agentEnv } from "@/lib/agent/env";
import type {
  AgentState,
  ChatMessage,
  FetchedPage,
  LLMProvider,
  ProviderDecision,
  SearchResult,
  ToolResult,
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

const decisionSchema = z.object({
  mode: z.enum(["respond", "search"]),
  rationale: z.string().min(1),
  query: z.string().optional(),
});

const searchSignals = [
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
];

const extractJson = (input: string) => {
  const fenced = input.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const objectMatch = input.match(/\{[\s\S]*\}/);
  return objectMatch?.[0]?.trim() ?? input.trim();
};

const summarizeSources = (results: SearchResult[], pages: FetchedPage[]) => {
  const pageSummaries = pages
    .map(
      (page, index) =>
        `${index + 1}. ${page.title} | ${page.url}\n${page.excerpt.slice(0, 240)}`,
    )
    .join("\n\n");

  if (pageSummaries) {
    return pageSummaries;
  }

  return results
    .map(
      (result, index) =>
        `${index + 1}. ${result.title} | ${result.url}\n${result.snippet}`,
    )
    .join("\n\n");
};

const summarizeToolResults = (toolResults: ToolResult[]) =>
  toolResults.map((toolResult) => ({
    tool: toolResult.tool,
    status: toolResult.status,
    provider: toolResult.provider,
    summary: toolResult.summary,
    errorType: toolResult.errorType,
    userMessage: toolResult.userMessage,
    skippedCount: toolResult.skippedCount,
    filteredCount: toolResult.filteredCount,
    recoverable: toolResult.recoverable,
    degradationMode: toolResult.degradationMode,
    attempts: toolResult.attempts,
  }));

const getSearchTool = (toolResults: ToolResult[]) =>
  [...toolResults].reverse().find((entry) => entry.tool === "searchWeb");

const getFetchedCount = (toolResults: ToolResult[]) =>
  toolResults.filter(
    (entry) => entry.tool === "fetchWebPage" && entry.status === "success",
  ).length;

const buildBackgroundAnswer = (userMessage: string) =>
  [
    "这次实时检索没有顺利完成，所以我先给你一版基于已有知识整理的背景回答。",
    `围绕“${userMessage}”，AI agent 近期适合产品演示的重点通常集中在三件事：第一，理解自然语言任务并自动拆解步骤；第二，调用搜索、文档、数据等工具完成执行链路；第三，把执行过程透明展示给用户，方便追踪、确认和人工干预。`,
    "如果你是做产品 Demo，建议突出“任务拆解、工具调用、结果回收、人工确认”这四个环节，而不是只展示聊天能力。这样更容易让用户理解 agent 和普通问答机器人的差别。",
    "如果你愿意，我也可以继续把这段背景回答改写成路演口径、官网文案，或者等实时检索恢复后再补一版带来源的最新摘要。",
  ].join("\n\n");

const createGroundedReply = ({
  userMessage,
  searchResults,
  fetchedCount,
  searchTool,
  fallbackMode,
}: {
  userMessage: string;
  searchResults: SearchResult[];
  fetchedCount: number;
  searchTool?: ToolResult;
  fallbackMode: AgentState["fallbackMode"];
}) => {
  if (!searchTool) {
    return "";
  }

  if (searchTool.status === "error") {
    return [
      `我刚刚尝试实时检索“${userMessage}”，但这次搜索没有成功完成。`,
      searchTool.userMessage || "搜索工具这次请求失败了，我会先继续给你一版背景回答。",
      buildBackgroundAnswer(userMessage),
    ].join("\n\n");
  }

  if (searchTool.status === "empty") {
    return [
      `我已经尝试实时检索“${userMessage}”，但这次没有拿到足够相关的结果。`,
      searchTool.userMessage ||
        "当前结果相关性不足。你可以换一个更具体的关键词，或补充时间范围和来源偏好。",
      buildBackgroundAnswer(userMessage),
    ].join("\n\n");
  }

  if (fallbackMode === "snippet-only" && searchResults.length > 0 && fetchedCount === 0) {
    const skipped = searchResults.filter((result) => result.fetchStatus === "skipped").length;
    return [
      "以下内容主要依据搜索摘要整理，正文抓取受限或被策略性跳过，因此证据强度弱于直接网页正文。",
      skipped > 0
        ? `其中有 ${skipped} 个结果因站点限制被跳过了正文抓取。`
        : "这批结果的正文抓取没有成功，所以我只能先基于摘要做整理。",
      "如果你需要更可靠的“最新动态”结论，建议补充更明确的媒体关键词，或指定希望优先参考的来源。",
    ].join("\n\n");
  }

  return "";
};

const createRateLimitReply = ({
  userMessage,
  searchResults,
  pageContents,
  toolResults,
  fallbackMode,
}: {
  userMessage: string;
  searchResults: SearchResult[];
  pageContents: FetchedPage[];
  toolResults: ToolResult[];
  fallbackMode: AgentState["fallbackMode"];
}) => {
  const groundedPrefix = createGroundedReply({
    userMessage,
    searchResults,
    fetchedCount: getFetchedCount(toolResults),
    searchTool: getSearchTool(toolResults),
    fallbackMode,
  });

  const sourceContext = summarizeSources(searchResults, pageContents);

  if (sourceContext) {
    return [
      groundedPrefix,
      "当前模型请求触发了限流，所以这版回答改为本地降级整理。",
      "我先把已经拿到的线索归纳给你：",
      sourceContext,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    "当前模型请求触发了限流（429），所以这轮回答切换到了本地降级模式。",
    buildBackgroundAnswer(userMessage),
  ].join("\n\n");
};

class MockLLMProvider implements LLMProvider {
  readonly id = "mock";

  readonly label = "Mock Provider";

  async decideNextAction(input: {
    userMessage: string;
    conversation: ChatMessage[];
  }): Promise<ProviderDecision> {
    const normalized = input.userMessage.toLowerCase();
    const needsSearch = searchSignals.some((signal) =>
      normalized.includes(signal.toLowerCase()),
    );

    if (needsSearch) {
      return {
        mode: "search",
        rationale: "The request looks time-sensitive or web-dependent.",
        query: input.userMessage.trim(),
      };
    }

    return {
      mode: "respond",
      rationale: "The request can be handled directly without external tools.",
    };
  }

  async composeAnswer(input: {
    userMessage: string;
    conversation: ChatMessage[];
    searchResults: SearchResult[];
    pageContents: FetchedPage[];
    toolResults: ToolResult[];
    fallbackMode: AgentState["fallbackMode"];
  }) {
    const searchTool = getSearchTool(input.toolResults);
    const fetchedCount = getFetchedCount(input.toolResults);
    const groundedPrefix = createGroundedReply({
      userMessage: input.userMessage,
      searchResults: input.searchResults,
      fetchedCount,
      searchTool,
      fallbackMode: input.fallbackMode,
    });

    if (groundedPrefix) {
      return groundedPrefix;
    }

    const historyHint = input.conversation
      .slice(-3)
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n");

    if (!input.searchResults.length && !input.pageContents.length) {
      return [
        "这是一个本地可运行的 Agent MVP 回复。",
        `我理解你的问题是：${input.userMessage}`,
        historyHint ? `最近上下文：\n${historyHint}` : "",
        "当前没有调用外部网页工具，所以这段回复来自内置 mock provider。配置好模型和搜索 API 后，它会自动切换到真实检索和真实模型能力。",
      ]
        .filter(Boolean)
        .join("\n\n");
    }

    const sources = summarizeSources(input.searchResults, input.pageContents);
    return [groundedPrefix, `我围绕“${input.userMessage}”整理到了这些可用线索：`, sources]
      .filter(Boolean)
      .join("\n\n");
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

  async decideNextAction(input: {
    userMessage: string;
    conversation: ChatMessage[];
  }): Promise<ProviderDecision> {
    try {
      const content = await this.generateText([
        {
          role: "system",
          content: [
            "You are a routing model for an agent.",
            "Choose whether the assistant should answer directly or search the web first.",
            "Return only JSON with keys: mode, rationale, query.",
            "Use mode=search only when freshness or web lookup is necessary.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              userMessage: input.userMessage,
              conversation: input.conversation.slice(-6),
            },
            null,
            2,
          ),
        },
      ]);

      const parsed = decisionSchema.safeParse(JSON.parse(extractJson(content)));
      if (parsed.success) {
        return parsed.data;
      }
    } catch (error) {
      if (!(error instanceof ModelRequestError) || error.status !== 429) {
        throw error;
      }
    }

    const normalized = input.userMessage.toLowerCase();
    const needsSearch = searchSignals.some((signal) =>
      normalized.includes(signal.toLowerCase()),
    );

    return {
      mode: needsSearch ? "search" : "respond",
      rationale: "Fallback to local routing because the model request was rate-limited.",
      query: needsSearch ? input.userMessage.trim() : undefined,
    };
  }

  async composeAnswer(input: {
    userMessage: string;
    conversation: ChatMessage[];
    searchResults: SearchResult[];
    pageContents: FetchedPage[];
    toolResults: ToolResult[];
    fallbackMode: AgentState["fallbackMode"];
  }) {
    const searchTool = getSearchTool(input.toolResults);
    const fetchedCount = getFetchedCount(input.toolResults);
    const groundedPrefix = createGroundedReply({
      userMessage: input.userMessage,
      searchResults: input.searchResults,
      fetchedCount,
      searchTool,
      fallbackMode: input.fallbackMode,
    });

    if (
      groundedPrefix &&
      (searchTool?.status === "error" || searchTool?.status === "empty")
    ) {
      return groundedPrefix;
    }

    const sourceContext = summarizeSources(input.searchResults, input.pageContents);

    try {
      return await this.generateText([
        {
          role: "system",
          content: [
            "You are a helpful assistant inside a web agent product.",
            "Be conservative and evidence-aware.",
            "Always explain the real-time retrieval status first when tools were attempted.",
            "Treat fetched page content as stronger evidence than search snippets.",
            "If only search snippets are available, explicitly say the answer is mainly based on search snippets and that page capture was limited or skipped.",
            "If real-time search failed, clearly state that limitation and then provide a useful background answer.",
            "Do not present community or forum snippets as confirmed news facts.",
            "If the result quality looks weak, say authoritative coverage is insufficient.",
            "Do not claim that you cannot access the internet unless the tool summary explicitly says the environment is offline.",
            "Avoid repetitive failure wording. Keep the limitation notice brief, then answer the user.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              userMessage: input.userMessage,
              recentConversation: input.conversation.slice(-6),
              fetchedPageCount: fetchedCount,
              snippetOnlyCount: input.searchResults.filter(
                (result) => result.fetchStatus !== "fetched",
              ).length,
              fallbackMode: input.fallbackMode,
              groundingPrefix: groundedPrefix,
              sources: sourceContext,
              toolResults: summarizeToolResults(input.toolResults),
            },
            null,
            2,
          ),
        },
      ]);
    } catch (error) {
      if (error instanceof ModelRequestError && error.status === 429) {
        return createRateLimitReply({
          userMessage: input.userMessage,
          searchResults: input.searchResults,
          pageContents: input.pageContents,
          toolResults: input.toolResults,
          fallbackMode: input.fallbackMode,
        });
      }

      throw error;
    }
  }

  private async generateText(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
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
        messages,
      }),
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
      choices?: Array<{ message?: { content?: string | null } }>;
    };

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Model response did not contain content.");
    }

    return content;
  }
}

export const createProvider = (): LLMProvider => {
  if (
    agentEnv.modelProvider !== "mock" &&
    agentEnv.openAiCompatApiKey &&
    agentEnv.openAiModel
  ) {
    return new OpenAICompatibleProvider(
      agentEnv.openAiCompatBaseUrl,
      agentEnv.openAiCompatApiKey,
      agentEnv.openAiModel,
    );
  }

  return new MockLLMProvider();
};
