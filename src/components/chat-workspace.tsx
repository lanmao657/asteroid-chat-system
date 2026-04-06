"use client";

import { startTransition, useDeferredValue, useEffect, useRef, useState } from "react";

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

const roleLabel: Record<ChatMessage["role"], string> = {
  user: "我",
  assistant: "小行星",
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

const AUTO_FOLLOW_THRESHOLD = 160;

export function ChatWorkspace() {
  const [bootSession] = useState<SessionSummary>(() => createSession());
  const [sessions, setSessions] = useState<SessionSummary[]>(() => [bootSession]);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => bootSession.id);
  const [messagesBySession, setMessagesBySession] = useState<
    Record<string, ChatMessage[]>
  >(() => ({ [bootSession.id]: [] }));
  const [, setActivityBySession] = useState<Record<string, ActivityItem[]>>(() => ({
    [bootSession.id]: [],
  }));
  const [streamingDraftBySession, setStreamingDraftBySession] = useState<
    Record<string, StreamingDraft | undefined>
  >(() => ({ [bootSession.id]: undefined }));
  const [draft, setDraft] = useState(INITIAL_PROMPT);
  const [status, setStatus] = useState("准备就绪");
  const [, setProviderLabel] = useState("OpenAI Compatible");
  const [activeRun, setActiveRun] = useState<ActiveRunState | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [shouldAutoFollow, setShouldAutoFollow] = useState(true);
  const activeControllerRef = useRef<AbortController | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
  const autoScrollingRef = useRef(false);
  const autoScrollingTimeoutRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const activeMessages = messagesBySession[activeSessionId] ?? [];
  const deferredMessages = useDeferredValue(activeMessages);
  const activeStreamingDraft = streamingDraftBySession[activeSessionId];
  const hasStreamingDraft = activeStreamingDraft !== undefined;
  const isStreaming = activeRun !== null;

  const isNearBottom = () => {
    const timeline = timelineRef.current;
    if (!timeline) {
      return true;
    }

    const remaining =
      timeline.scrollHeight - (timeline.scrollTop + timeline.clientHeight);
    return remaining <= AUTO_FOLLOW_THRESHOLD;
  };

  const scrollToLatest = (behavior: ScrollBehavior = "auto") => {
    const timeline = timelineRef.current;
    if (!timeline) {
      return;
    }

    autoScrollingRef.current = true;
    if (autoScrollingTimeoutRef.current !== null) {
      window.clearTimeout(autoScrollingTimeoutRef.current);
    }
    timeline.scrollTo({
      top: timeline.scrollHeight,
      behavior,
    });
    autoScrollingTimeoutRef.current = window.setTimeout(() => {
      autoScrollingRef.current = false;
      autoScrollingTimeoutRef.current = null;
    }, 140);
  };

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

  useEffect(() => {
    const pauseAutoFollow = () => {
      autoScrollingRef.current = false;
      if (autoScrollingTimeoutRef.current !== null) {
        window.clearTimeout(autoScrollingTimeoutRef.current);
        autoScrollingTimeoutRef.current = null;
      }
      setShouldAutoFollow(false);
    };

    const handleScroll = () => {
      if (!isStreaming || autoScrollingRef.current) {
        return;
      }

      const nextShouldAutoFollow = isNearBottom();
      setShouldAutoFollow((current) =>
        current === nextShouldAutoFollow ? current : nextShouldAutoFollow,
      );
    };

    const handleWheel = (event: WheelEvent) => {
      if (!isStreaming) {
        return;
      }

      if (event.deltaY < 0) {
        pauseAutoFollow();
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      touchStartYRef.current = event.touches[0]?.clientY ?? null;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!isStreaming) {
        return;
      }

      const currentY = event.touches[0]?.clientY;
      const startY = touchStartYRef.current;
      if (currentY === undefined || startY === null) {
        return;
      }

      if (currentY - startY > 6) {
        pauseAutoFollow();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isStreaming) {
        return;
      }

      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) {
        pauseAutoFollow();
      }
    };

    const timeline = timelineRef.current;
    if (!timeline) {
      return;
    }

    timeline.addEventListener("scroll", handleScroll, { passive: true });
    timeline.addEventListener("wheel", handleWheel, { passive: true });
    timeline.addEventListener("touchstart", handleTouchStart, { passive: true });
    timeline.addEventListener("touchmove", handleTouchMove, { passive: true });
    timeline.addEventListener("keydown", handleKeyDown);
    return () => {
      timeline.removeEventListener("scroll", handleScroll);
      timeline.removeEventListener("wheel", handleWheel);
      timeline.removeEventListener("touchstart", handleTouchStart);
      timeline.removeEventListener("touchmove", handleTouchMove);
      timeline.removeEventListener("keydown", handleKeyDown);
    };
  }, [isStreaming]);

  useEffect(() => {
    if (!shouldAutoFollow) {
      return;
    }

    scrollToLatest(hasStreamingDraft ? "auto" : "smooth");
  }, [
    activeSessionId,
    activeStreamingDraft?.content,
    activeStreamingDraft?.status,
    deferredMessages.length,
    hasStreamingDraft,
    shouldAutoFollow,
  ]);

  useEffect(() => {
    return () => {
      if (autoScrollingTimeoutRef.current !== null) {
        window.clearTimeout(autoScrollingTimeoutRef.current);
      }
    };
  }, []);

  const closeSidebar = () => {
    setIsSidebarOpen(false);
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
    setShouldAutoFollow(true);
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
      setShouldAutoFollow(true);
    });
  };

  const handleSelectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setShouldAutoFollow(true);
    closeSidebar();
  };

  const activeTitle =
    sessions.find((session) => session.id === activeSessionId)?.title ?? "新对话";

  return (
    <div className={styles.shell} data-sidebar-open={isSidebarOpen}>
      <button
        aria-hidden={!isSidebarOpen}
        className={styles.sidebarBackdrop}
        data-open={isSidebarOpen}
        onClick={closeSidebar}
        tabIndex={isSidebarOpen ? 0 : -1}
        type="button"
      />

      <aside className={styles.sidebar} data-open={isSidebarOpen}>
        <div className={styles.sidebarTop}>
          <div className={styles.brandBlock}>
            <div className={styles.logoMark}>小</div>
            <div>
              <div className={styles.logoTitle}>小行星</div>
              <div className={styles.logoSub}>你的中文智能对话空间</div>
            </div>
          </div>

          <button
            aria-label="收起历史对话"
            className={styles.iconButton}
            onClick={closeSidebar}
            type="button"
          >
            ×
          </button>
        </div>

        <button
          className={styles.newButton}
          disabled={isStreaming}
          onClick={createFreshSession}
          type="button"
        >
          新建对话
        </button>

        <div className={styles.sessionHeader}>对话记录</div>
        <div className={styles.sessionList}>
          {sessions.map((session) => (
            <button
              className={styles.sessionButton}
              data-active={session.id === activeSessionId}
              key={session.id}
              onClick={() => handleSelectSession(session.id)}
              type="button"
            >
              <span className={styles.sessionName}>{session.title}</span>
              <span className={styles.sessionMeta}>{formatTime(session.updatedAt)}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button
              aria-label="展开历史对话"
              className={styles.iconButton}
              onClick={() => setIsSidebarOpen(true)}
              type="button"
            >
              ☰
            </button>
            <button
              className={styles.topNewButton}
              disabled={isStreaming}
              onClick={createFreshSession}
              type="button"
            >
              新建对话
            </button>
          </div>

          <div className={styles.topbarTitle}>小行星</div>
        </header>

        <section className={styles.chatStage}>
          <div className={styles.chatFrame}>
            <div className={styles.chatHeader}>
              <div>
                <div className={styles.sectionTitle}>{activeTitle}</div>
                <div className={styles.sectionMeta}>对话记录</div>
              </div>
              <div className={styles.statusBadge}>{status}</div>
            </div>

            <div
              className={styles.timeline}
              ref={timelineRef}
              tabIndex={0}
            >
              {deferredMessages.length === 0 && !activeStreamingDraft ? (
                <div className={styles.empty}>
                  <div className={styles.emptyTitle}>今天想聊点什么？</div>
                  <div className={styles.emptyBody}>
                    在这里输入问题，小行星会把回答留在页面中央，输入框也会始终跟着你。
                  </div>
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
                        <span>{roleLabel[message.role]}</span>
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
                          小行星
                          {activeStreamingDraft.status === "stopped" ? " · 已停止" : ""}
                        </span>
                        <span>{formatTime(activeStreamingDraft.createdAt)}</span>
                      </div>
                      <ChatMessageContent
                        content={activeStreamingDraft.content || "正在生成中..."}
                        role="assistant"
                      />
                    </article>
                  ) : null}

                  <div
                    aria-hidden="true"
                    className={styles.timelineAnchor}
                    ref={bottomAnchorRef}
                  />
                </div>
              )}
            </div>

            <section className={styles.composerDock}>
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
                  placeholder="输入你的问题，例如：常见的前端和后端技术有哪些"
                  value={draft}
                />

                <div className={styles.composerFooter}>
                  <div className={styles.composerHint}>
                    {isStreaming ? "正在生成回答，可随时停止" : "按 Cmd/Ctrl + Enter 发送"}
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
          </div>
        </section>
      </main>
    </div>
  );
}
