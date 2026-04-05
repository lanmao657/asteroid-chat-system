"use client";

import { startTransition, useDeferredValue, useRef, useState } from "react";

import { ChatMessageContent } from "@/components/chat-message-content";
import { resolveAssistantFinalMessage } from "@/components/chat-stream";
import styles from "@/components/chat-workspace.module.css";
import type { AgentStreamEvent, ChatMessage, ToolResult } from "@/lib/agent/types";

interface SessionSummary {
  id: string;
  title: string;
  updatedAt: number;
}

interface ActivityItem {
  id: string;
  kind: "memory" | "tool-started" | "tool-progress" | "tool-result" | "run";
  title: string;
  body: string;
  detail?: string;
  createdAt: string;
}

interface StreamingDraft {
  id: string;
  content: string;
  status: "streaming" | "stopped";
  createdAt: string;
}

interface ActiveRunState {
  sessionId: string;
  runId: string;
}

const INITIAL_PROMPT =
  "帮我查一下最近关于 AI agent 的新闻，并整理成一段适合产品演示的中文摘要。";

const formatTime = (value: string | number) =>
  new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));

const createSession = (): SessionSummary => ({
  id: crypto.randomUUID(),
  title: "新对话",
  updatedAt: Date.now(),
});

const createLocalMessage = (
  role: ChatMessage["role"],
  content: string,
  metadata?: Record<string, unknown>,
): ChatMessage => ({
  id: crypto.randomUUID(),
  role,
  content,
  createdAt: new Date().toISOString(),
  metadata,
});

const createActivity = (
  kind: ActivityItem["kind"],
  title: string,
  body: string,
  detail?: string,
): ActivityItem => ({
  id: crypto.randomUUID(),
  kind,
  title,
  body,
  detail,
  createdAt: new Date().toISOString(),
});

const sessionTitleFrom = (message: string) => {
  const compact = message.trim().replace(/\s+/g, " ");
  return compact.length > 24 ? `${compact.slice(0, 24)}...` : compact || "新对话";
};

const normalizeProviderLabel = (label: string) => {
  if (label.includes("OpenAI")) {
    return "OpenAI Compatible";
  }
  if (label.includes("Mock")) {
    return "Mock Provider";
  }
  return label;
};

const formatErrorMessage = (message: string) => {
  if (message.includes("429")) {
    return "上游模型限流（429），请稍后重试，或切换到更稳定的模型配置。";
  }
  if (message.includes("OpenAI-compatible API is not configured")) {
    return "模型 API 尚未配置，请检查 .env.local 中的 API Key 和模型名。";
  }
  if (message.includes("Model response did not contain content")) {
    return "上游模型这次没有返回有效内容，请稍后重试。";
  }
  if (message.includes("status 401")) {
    return "模型 API 鉴权失败（401），请检查 API Key 是否正确。";
  }
  if (message.includes("status 402")) {
    return "模型 API 账户额度不足或计费不可用（402）。";
  }
  if (message.includes("status 403")) {
    return "模型 API 当前无权访问所选模型（403）。";
  }
  if (message.includes("status 5")) {
    return "上游模型服务暂时不可用，请稍后重试。";
  }

  return `请求失败：${message}`;
};

const safeJson = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
};

const describeToolResult = (toolResult: ToolResult) => {
  const provider = toolResult.provider ? ` · ${toolResult.provider}` : "";
  return `${toolResult.tool}${provider} · ${toolResult.status}`;
};

const toolResultDetail = (toolResult: ToolResult) => {
  if (toolResult.detail) {
    return toolResult.detail;
  }
  if (toolResult.trace && toolResult.trace.length > 0) {
    return safeJson(toolResult.trace);
  }
  return "";
};

export function ChatWorkspace() {
  const [bootSession] = useState<SessionSummary>(() => createSession());
  const [sessions, setSessions] = useState<SessionSummary[]>(() => [bootSession]);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => bootSession.id);
  const [messagesBySession, setMessagesBySession] = useState<
    Record<string, ChatMessage[]>
  >(() => ({ [bootSession.id]: [] }));
  const [activityBySession, setActivityBySession] = useState<
    Record<string, ActivityItem[]>
  >(() => ({ [bootSession.id]: [] }));
  const [streamingDraftBySession, setStreamingDraftBySession] = useState<
    Record<string, StreamingDraft | undefined>
  >(() => ({ [bootSession.id]: undefined }));
  const [draft, setDraft] = useState(INITIAL_PROMPT);
  const [status, setStatus] = useState("准备就绪");
  const [providerLabel, setProviderLabel] = useState("OpenAI Compatible");
  const [activeRun, setActiveRun] = useState<ActiveRunState | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);

  const activeMessages = messagesBySession[activeSessionId] ?? [];
  const deferredMessages = useDeferredValue(activeMessages);
  const activeActivities = activityBySession[activeSessionId] ?? [];
  const activeStreamingDraft = streamingDraftBySession[activeSessionId];
  const isStreaming = activeRun !== null;

  const upsertSession = (sessionId: string, title: string) => {
    setSessions((current) => {
      const existing = current.find((session) => session.id === sessionId);
      if (!existing) {
        return [{ id: sessionId, title, updatedAt: Date.now() }, ...current];
      }

      return current
        .map((session) =>
          session.id === sessionId
            ? { ...session, title, updatedAt: Date.now() }
            : session,
        )
        .sort((left, right) => right.updatedAt - left.updatedAt);
    });
  };

  const appendMessage = (sessionId: string, message: ChatMessage) => {
    setMessagesBySession((current) => ({
      ...current,
      [sessionId]: [...(current[sessionId] ?? []), message],
    }));
  };

  const appendActivity = (sessionId: string, activity: ActivityItem) => {
    setActivityBySession((current) => ({
      ...current,
      [sessionId]: [...(current[sessionId] ?? []), activity].slice(-20),
    }));
  };

  const updateStreamingDraft = (
    sessionId: string,
    updater: (current: StreamingDraft | undefined) => StreamingDraft,
  ) => {
    setStreamingDraftBySession((current) => ({
      ...current,
      [sessionId]: updater(current[sessionId]),
    }));
  };

  const clearStreamingDraft = (sessionId: string) => {
    setStreamingDraftBySession((current) => ({
      ...current,
      [sessionId]: undefined,
    }));
  };

  const stopCurrentRun = () => {
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
    setActiveRun(null);
    setStatus("已停止");

    if (activeSessionId) {
      setStreamingDraftBySession((current) => {
        const existing = current[activeSessionId];
        if (!existing) {
          return current;
        }

        return {
          ...current,
          [activeSessionId]: { ...existing, status: "stopped" },
        };
      });
    }
  };

  const handleEvent = (sessionId: string, event: AgentStreamEvent) => {
    if (event.type === "run_started") {
      setActiveRun({ sessionId, runId: event.runId });
      appendActivity(
        sessionId,
        createActivity("run", "运行开始", `本轮运行 ID：${event.runId}`),
      );
      setStatus("正在准备上下文...");
      return;
    }

    if (event.type === "session") {
      const normalizedLabel = normalizeProviderLabel(event.provider);
      setProviderLabel(normalizedLabel);
      setStatus(`已连接到 ${normalizedLabel}`);
      return;
    }

    if (event.type === "memory_compacted") {
      appendActivity(
        sessionId,
        createActivity(
          "memory",
          event.degraded ? "摘要复用" : "摘要更新",
          event.message,
          event.summary,
        ),
      );
      return;
    }

    if (event.type === "tool_started") {
      appendActivity(
        sessionId,
        createActivity(
          "tool-started",
          `${event.toolCall.phase} -> ${event.toolCall.tool}`,
          "工具已启动",
          safeJson(event.toolCall.input),
        ),
      );
      return;
    }

    if (event.type === "tool_progress") {
      appendActivity(
        sessionId,
        createActivity(
          "tool-progress",
          event.progress.message,
          event.progress.detail ?? event.progress.tool,
        ),
      );
      setStatus(event.progress.message);
      return;
    }

    if (event.type === "tool_result") {
      appendActivity(
        sessionId,
        createActivity(
          "tool-result",
          describeToolResult(event.toolResult),
          event.toolResult.summary,
          toolResultDetail(event.toolResult),
        ),
      );
      setStatus(event.toolResult.summary);
      return;
    }

    if (event.type === "assistant_started") {
      setStatus("正在生成回答...");
      return;
    }

    if (event.type === "assistant_delta") {
      updateStreamingDraft(sessionId, (current) => ({
        id: current?.id ?? crypto.randomUUID(),
        content: `${current?.content ?? ""}${event.delta}`,
        status: "streaming",
        createdAt: current?.createdAt ?? new Date().toISOString(),
      }));
      return;
    }

    if (event.type === "assistant_final") {
      const resolved = resolveAssistantFinalMessage({
        draftContent: streamingDraftBySession[sessionId]?.content,
        finalMessage: event.message,
      });
      clearStreamingDraft(sessionId);
      appendMessage(sessionId, resolved.message);
      if (resolved.usedDraft) {
        appendActivity(
          sessionId,
          createActivity(
            "run",
            "Final 保护",
            "检测到 final 文本短于已流出的草稿，已保留更长的流式内容。",
            safeJson(resolved.message.metadata),
          ),
        );
      }
      setStatus("回答完成");
      return;
    }

    if (event.type === "assistant_aborted") {
      setStreamingDraftBySession((current) => {
        const existing = current[sessionId];
        if (!existing) {
          return current;
        }

        return {
          ...current,
          [sessionId]: { ...existing, status: "stopped" },
        };
      });
      appendActivity(sessionId, createActivity("run", "运行中断", event.message));
      setStatus("已停止");
      setActiveRun(null);
      activeControllerRef.current = null;
      return;
    }

    if (event.type === "error") {
      const formatted = formatErrorMessage(event.message);
      setStatus(formatted);
      clearStreamingDraft(sessionId);
      appendMessage(
        sessionId,
        createLocalMessage("assistant", formatted, {
          kind: "system-error",
        }),
      );
      setActiveRun(null);
      activeControllerRef.current = null;
      return;
    }

    if (event.type === "done") {
      setActiveRun(null);
      activeControllerRef.current = null;
    }
  };

  const submitPrompt = async () => {
    const content = draft.trim();
    if (!content || !activeSessionId || isStreaming) {
      return;
    }

    const sessionId = activeSessionId;
    const controller = new AbortController();
    activeControllerRef.current = controller;
    clearStreamingDraft(sessionId);
    setProviderLabel("OpenAI Compatible");
    setStatus("正在提交请求...");
    appendActivity(sessionId, createActivity("run", "用户发起请求", content));

    const userMessage = createLocalMessage("user", content);
    appendMessage(sessionId, userMessage);
    upsertSession(sessionId, sessionTitleFrom(content));
    setDraft("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId,
          message: content,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        setStatus("无法连接到 /api/chat");
        setActiveRun(null);
        activeControllerRef.current = null;
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
          if (!dataLine) {
            continue;
          }

          const event = JSON.parse(dataLine.slice(6)) as AgentStreamEvent;
          handleEvent(sessionId, event);
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("已停止");
        return;
      }

      const message = "请求没有顺利完成，请稍后重试。";
      setStatus(message);
      clearStreamingDraft(sessionId);
      appendMessage(
        sessionId,
        createLocalMessage("assistant", message, {
          kind: "system-error",
        }),
      );
      setActiveRun(null);
      activeControllerRef.current = null;
    }
  };

  const createFreshSession = () => {
    if (isStreaming) {
      return;
    }

    startTransition(() => {
      const session = createSession();
      setSessions((current) => [session, ...current]);
      setActiveSessionId(session.id);
      setMessagesBySession((current) => ({
        ...current,
        [session.id]: [],
      }));
      setActivityBySession((current) => ({
        ...current,
        [session.id]: [],
      }));
      setStreamingDraftBySession((current) => ({
        ...current,
        [session.id]: undefined,
      }));
      setStatus("已新建一条对话。");
      setDraft("");
      setProviderLabel("OpenAI Compatible");
    });
  };

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.logoRow}>
          <div className={styles.logoMark}>A</div>
          <div>
            <div className={styles.logoTitle}>Agent Workspace</div>
            <div className={styles.logoSub}>可观测的流式聊天工作台</div>
          </div>
        </div>

        <button
          className={styles.newButton}
          disabled={isStreaming}
          onClick={createFreshSession}
          type="button"
        >
          新建对话
        </button>

        <div className={styles.sessionHeader}>最近会话</div>
        <div className={styles.sessionList}>
          {sessions.map((session) => (
            <button
              className={styles.sessionButton}
              data-active={session.id === activeSessionId}
              key={session.id}
              onClick={() => setActiveSessionId(session.id)}
              type="button"
            >
              <span className={styles.sessionName}>{session.title}</span>
              <span className={styles.sessionMeta}>{formatTime(session.updatedAt)}</span>
            </button>
          ))}
        </div>

        <div className={styles.sidebarFooter}>
          <div className={styles.sidebarLabel}>Provider</div>
          <div className={styles.sidebarValue}>{providerLabel}</div>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.hero}>
          <div className={styles.heroInner}>
            <span className={styles.eyebrow}>Observable Agent Chat</span>
            <h1 className={styles.heroHeadline}>查询重写、评分门控与混合检索都可实时查看</h1>
            <p className={styles.heroBody}>
              这一版把工具路由、知识库检索、天气查询、网页检索、文档评分、查询重写和 rerank
              都接进了同一条可观测链路。前端会在回答生成前持续展示每一步细节，而不是静默等待。
            </p>
          </div>
        </header>

        <section className={styles.workspace}>
          <div className={styles.timelineWrap}>
            <div className={styles.timelineHeader}>
              <div>
                <div className={styles.sectionLabel}>Conversation</div>
                <div className={styles.sectionTitle}>对话记录</div>
              </div>
              <div className={styles.statusBadge}>{status}</div>
            </div>

            <div className={styles.timeline}>
              {deferredMessages.length === 0 && !activeStreamingDraft ? (
                <div className={styles.empty}>
                  输入一个问题开始聊天。你可以直接问最新新闻、天气，或要求系统从知识库里找答案。
                </div>
              ) : (
                <div className={styles.timelineInner}>
                  {deferredMessages.map((message) => (
                    <article
                      className={styles.message}
                      data-role={message.role}
                      key={message.id}
                    >
                      <div className={styles.messageMeta}>
                        <span>{message.role}</span>
                        <span>{formatTime(message.createdAt)}</span>
                      </div>
                      <ChatMessageContent
                        content={message.content}
                        role={message.role}
                      />
                    </article>
                  ))}

                  {activeStreamingDraft ? (
                    <article className={styles.message} data-role="assistant">
                      <div className={styles.messageMeta}>
                        <span>
                          assistant
                          {activeStreamingDraft.status === "stopped" ? " · stopped" : ""}
                        </span>
                        <span>{formatTime(activeStreamingDraft.createdAt)}</span>
                      </div>
                      <ChatMessageContent
                        content={activeStreamingDraft.content || "正在生成中..."}
                        role="assistant"
                      />
                    </article>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          <aside className={styles.inspector}>
            <section className={styles.panel}>
              <div className={styles.sectionLabel}>Runtime</div>
              <div className={styles.sectionTitle}>系统状态</div>
              <div className={styles.panelValue}>{status}</div>
            </section>

            <section className={styles.panel}>
              <div className={styles.sectionLabel}>Activity</div>
              <div className={styles.sectionTitle}>RAG 与工具过程</div>
              <div className={styles.toolList}>
                {activeActivities.length === 0 ? (
                  <div className={styles.panelMuted}>
                    这里会展示 routing、searching、grading、rewriting、reranking 等执行步骤。
                  </div>
                ) : (
                  activeActivities
                    .slice()
                    .reverse()
                    .map((activity) => (
                      <details className={styles.toolItem} key={activity.id}>
                        <summary className={styles.toolSummaryHeader}>
                          <span className={styles.toolName}>{activity.title}</span>
                          <span className={styles.toolTime}>{formatTime(activity.createdAt)}</span>
                        </summary>
                        <div className={styles.toolSummary}>{activity.body}</div>
                        {activity.detail ? (
                          <pre className={styles.toolDetail}>{activity.detail}</pre>
                        ) : null}
                      </details>
                    ))
                )}
              </div>
            </section>
          </aside>
        </section>

        <section className={styles.composer}>
          <div className={styles.composerSurface}>
            <textarea
              className={styles.textarea}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  if (isStreaming) {
                    stopCurrentRun();
                    return;
                  }
                  void submitPrompt();
                }
              }}
              placeholder="输入你的问题，例如：帮我整理 AI agent 最近一周的重要动态，或者查一下上海天气。"
              value={draft}
            />

            <div className={styles.composerFooter}>
              <div className={styles.composerHint}>
                {isStreaming ? "正在流式返回，可随时停止生成" : "按 Cmd/Ctrl + Enter 发送"}
              </div>
              <button
                className={styles.sendButton}
                disabled={!isStreaming && !draft.trim()}
                onClick={() => {
                  if (isStreaming) {
                    stopCurrentRun();
                    return;
                  }
                  void submitPrompt();
                }}
                type="button"
              >
                {isStreaming ? "停止生成" : "发送"}
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
