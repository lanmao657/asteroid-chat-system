"use client";

import { startTransition, useDeferredValue, useEffect, useRef, useState } from "react";

import { ActivityPanel } from "@/components/chat/activity-panel";
import { AppSidebar } from "@/components/chat/app-sidebar";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatInputPanel } from "@/components/chat/chat-input-panel";
import { EmptyState } from "@/components/chat/empty-state";
import { MessageList } from "@/components/chat/message-list";
import type {
  ActivityItem,
  PromptSuggestion,
  SessionSummary,
  StreamingDraft,
} from "@/components/chat/types";
import { resolveAssistantFinalMessage } from "@/components/chat-stream";
import styles from "@/components/chat-workspace.module.css";
import type { AgentStreamEvent, ChatMessage, ToolResult } from "@/lib/agent/types";

interface ActiveRunState {
  sessionId: string;
  runId: string;
}

const INITIAL_PROMPT = "";

const PROMPT_SUGGESTIONS: PromptSuggestion[] = [
  {
    id: "daily-news",
    title: "总结今天的重要新闻",
    prompt: "帮我总结今天的重要新闻，并整理成一段适合晨会同步的中文摘要。",
    description: "快速拉一份适合团队同步的中文摘要。",
  },
  {
    id: "singapore-weather",
    title: "查看新加坡天气",
    prompt: "帮我查一下新加坡今天的天气，并给出穿衣和出行建议。",
    description: "适合验证天气工具和结构化回答效果。",
  },
  {
    id: "postgres-error",
    title: "解释 PostgreSQL 错误",
    prompt: "帮我解释一个 PostgreSQL 连接错误，并按排查优先级给出解决思路。",
    description: "看看 Asteroid 如何处理技术排障类问题。",
  },
  {
    id: "tech-search",
    title: "搜索技术问题",
    prompt: "帮我搜索一个前端性能问题，并整理成清晰的排查步骤和建议。",
    description: "适合验证 web search 和工具链路的展示。",
  },
];

const TEXTAREA_MAX_HEIGHT = 220;
const AUTO_FOLLOW_THRESHOLD = 160;

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
    return "模型 API 尚未配置，请检查 .env.local 中的 API Key 和模型名称。";
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
  const [messagesBySession, setMessagesBySession] = useState<Record<string, ChatMessage[]>>(() => ({
    [bootSession.id]: [],
  }));
  const [activityBySession, setActivityBySession] = useState<Record<string, ActivityItem[]>>(() => ({
    [bootSession.id]: [],
  }));
  const [streamingDraftBySession, setStreamingDraftBySession] = useState<
    Record<string, StreamingDraft | undefined>
  >(() => ({ [bootSession.id]: undefined }));
  const [draft, setDraft] = useState(INITIAL_PROMPT);
  const [status, setStatus] = useState("准备就绪");
  const [providerLabel, setProviderLabel] = useState("OpenAI Compatible");
  const [activeRun, setActiveRun] = useState<ActiveRunState | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [shouldAutoFollow, setShouldAutoFollow] = useState(true);
  const activeControllerRef = useRef<AbortController | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const autoScrollingRef = useRef(false);
  const autoScrollingTimeoutRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const activeMessages = messagesBySession[activeSessionId] ?? [];
  const activeActivities = activityBySession[activeSessionId] ?? [];
  const deferredMessages = useDeferredValue(activeMessages);
  const activeStreamingDraft = streamingDraftBySession[activeSessionId];
  const hasStreamingDraft = activeStreamingDraft !== undefined;
  const isStreaming = activeRun !== null;

  const isNearBottom = () => {
    const timeline = timelineRef.current;
    if (!timeline) {
      return true;
    }

    const remaining = timeline.scrollHeight - (timeline.scrollTop + timeline.clientHeight);
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
          session.id === sessionId ? { ...session, title, updatedAt: Date.now() } : session,
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
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    const nextHeight = Math.min(textarea.scrollHeight, TEXTAREA_MAX_HEIGHT);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
  }, [activeSessionId, draft]);

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

  const focusComposer = () => {
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  };

  const stopCurrentRun = () => {
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
    setActiveRun(null);
    setStatus("已停止");

    const runSessionId = activeRun?.sessionId ?? activeSessionId;
    if (runSessionId) {
      setStreamingDraftBySession((current) => {
        const existing = current[runSessionId];
        if (!existing) {
          return current;
        }

        return {
          ...current,
          [runSessionId]: { ...existing, status: "stopped" },
        };
      });
    }
  };

  const handleEvent = (sessionId: string, event: AgentStreamEvent) => {
    if (event.type === "run_started") {
      setActiveRun({ sessionId, runId: event.runId });
      appendActivity(sessionId, createActivity("run", "运行开始", `本轮运行 ID：${event.runId}`));
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
          `${event.toolCall.phase} → ${event.toolCall.tool}`,
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
      focusComposer();
    });
  };

  const handleSelectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setShouldAutoFollow(true);
  };

  const handleSuggestionSelect = (prompt: string) => {
    setDraft(prompt);
    focusComposer();
  };

  const handleComposerKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (isStreaming) {
        stopCurrentRun();
        return;
      }
      void submitPrompt();
    }
  };

  const activeTitle =
    sessions.find((session) => session.id === activeSessionId)?.title ?? "新对话";

  return (
    <div className={styles.shell} data-sidebar-open={isSidebarOpen}>
      <aside className={styles.sidebar} data-open={isSidebarOpen}>
        <AppSidebar
          activeSessionId={activeSessionId}
          formatTime={formatTime}
          isCollapsed={!isSidebarOpen}
          isStreaming={isStreaming}
          onCollapse={() => setIsSidebarOpen(false)}
          onCreateSession={createFreshSession}
          onSelectSession={handleSelectSession}
          sessions={sessions}
        />
      </aside>

      <main className={styles.main}>
        <ChatHeader
          onCreateSession={createFreshSession}
          onExpandSidebar={() => setIsSidebarOpen(true)}
          providerLabel={providerLabel}
          sidebarCollapsed={!isSidebarOpen}
          status={status}
          title={activeTitle}
        />

        <div className={styles.workspaceGrid}>
          <section className={styles.conversationColumn}>
            <div className={styles.timelineShell}>
              <MessageList
                emptyState={
                  <EmptyState
                    onSelectSuggestion={handleSuggestionSelect}
                    suggestions={PROMPT_SUGGESTIONS}
                  />
                }
                formatTime={formatTime}
                messages={deferredMessages}
                streamingDraft={activeStreamingDraft}
                timelineRef={timelineRef}
              />
            </div>

            <ChatInputPanel
              draft={draft}
              isStreaming={isStreaming}
              onChange={setDraft}
              onKeyDown={handleComposerKeyDown}
              onStop={stopCurrentRun}
              onSubmit={() => void submitPrompt()}
              textareaRef={textareaRef}
            />
          </section>

          <ActivityPanel activities={activeActivities} formatTime={formatTime} status={status} />
        </div>
      </main>
    </div>
  );
}
