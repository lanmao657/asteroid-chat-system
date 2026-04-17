"use client";

import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type KeyboardEventHandler,
} from "react";

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
import {
  formatToolProgressMessage,
  formatToolResultDetail,
  formatToolResultSummary,
  formatToolResultTitle,
  formatToolStartedTitle,
  localizeTraceText,
} from "@/lib/agent/trace-presentation";
import {
  buildChatSessionMessagesPath,
  buildInitialSessionList,
  DEFAULT_CHAT_SESSION_TITLE,
  getChatSessionTitle,
  hasComposerDraft,
  mergePersistedSessions,
  shouldPreserveLocalSessionState,
  sortSessionsByActivity,
} from "@/lib/chat/sessions";
import type { AgentRunTrace, AgentStreamEvent, ChatMessage, RetrievalStep } from "@/lib/agent/types";

interface ActiveRunState {
  sessionId: string;
  runId: string;
}

interface ChatSessionsResponse {
  items: SessionSummary[];
}

interface ChatSessionMessagesResponse {
  session: SessionSummary;
  items: ChatMessage[];
}

const INITIAL_PROMPT = "";
const TEXTAREA_MAX_HEIGHT = 220;
const AUTO_FOLLOW_THRESHOLD = 160;
const MAX_THOUGHT_STEPS = 20;

const PROMPT_SUGGESTIONS: PromptSuggestion[] = [
  {
    id: "expense-policy",
    title: "查询报销制度",
    prompt:
      "新员工出差回来后报销流程怎么走？请按结论、适用范围、操作步骤、注意事项和来源说明回答。",
    description: "验证制度问答和内部知识引用是否清晰。",
  },
  {
    id: "onboarding-checklist",
    title: "整理入职清单",
    prompt: "请根据新员工培训手册整理一份前 30 天入职学习清单，按周拆分重点任务。",
    description: "适合验证培训资料整理与行动项输出。",
  },
  {
    id: "refund-sop",
    title: "根据客服 SOP 回答",
    prompt:
      "客户因为退款到账慢而投诉时，客服应该怎么回复？请结合客服退款争议处理 SOP 给出标准说法。",
    description: "检查 SOP 检索、步骤化回答和话术建议。",
  },
  {
    id: "sales-brief",
    title: "总结销售培训资料",
    prompt:
      "请总结新版产品卖点与销售话术指引，给业务同学一份简短的销售培训摘要。",
    description: "适合验证 FAQ、培训资料和知识复用。",
  },
];

const formatTime = (value: string | number) =>
  new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));

const createSession = (): SessionSummary => ({
  id: crypto.randomUUID(),
  title: DEFAULT_CHAT_SESSION_TITLE,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastMessageAt: null,
  isDraft: true,
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

const createThoughtDraft = (current?: StreamingDraft): StreamingDraft => ({
  id: current?.id ?? crypto.randomUUID(),
  content: current?.content ?? "",
  status: current?.status ?? "streaming",
  createdAt: current?.createdAt ?? new Date().toISOString(),
  trace: current?.trace,
  thoughts: current?.thoughts ?? [],
});

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
    return "模型 API 尚未配置，请检查 `.env.local` 中的 API Key 和模型名称。";
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

const getErrorMessageFromResponse = async (
  response: Response,
  fallback: string,
) => {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error?.trim() || fallback;
  } catch {
    return fallback;
  }
};

const attachAssistantMetadataToMessage = ({
  message,
  thoughts,
  trace,
}: {
  message: ChatMessage;
  thoughts: ActivityItem[];
  trace?: AgentRunTrace;
}): ChatMessage => {
  if (thoughts.length === 0 && !trace) {
    return message;
  }

  return {
    ...message,
    metadata: {
      ...message.metadata,
      thoughts,
      trace,
    },
  };
};

const createRagStepActivity = (step: RetrievalStep) =>
  createActivity(
    "run",
    step.label,
    step.detail,
    step.metadata ? safeJson(step.metadata) : undefined,
  );

const isKnowledgeBaseToolEvent = (
  event:
    | Extract<AgentStreamEvent, { type: "tool_started" }>
    | Extract<AgentStreamEvent, { type: "tool_progress" }>
    | Extract<AgentStreamEvent, { type: "tool_result" }>,
) => {
  if (event.type === "tool_started") {
    return event.toolCall.tool === "knowledgeBaseSearch" || event.toolCall.phase === "route";
  }
  if (event.type === "tool_progress") {
    return (
      event.progress.tool === "knowledgeBaseSearch" ||
      event.progress.message.startsWith("Routing ->")
    );
  }
  return (
    event.toolResult.tool === "knowledgeBaseSearch" &&
    event.toolResult.status !== "error"
  );
};

export function ChatWorkspace() {
  const [bootSession] = useState<SessionSummary>(() => createSession());
  const [sessions, setSessions] = useState<SessionSummary[]>(() => [bootSession]);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => bootSession.id);
  const [messagesBySession, setMessagesBySession] = useState<Record<string, ChatMessage[]>>(() => ({
    [bootSession.id]: [],
  }));
  const [streamingDraftBySession, setStreamingDraftBySession] = useState<
    Record<string, StreamingDraft | undefined>
  >(() => ({ [bootSession.id]: undefined }));
  const [draft, setDraft] = useState(INITIAL_PROMPT);
  const [status, setStatus] = useState("企业知识助手已就绪");
  const [providerLabel, setProviderLabel] = useState("OpenAI Compatible");
  const [activeRun, setActiveRun] = useState<ActiveRunState | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [shouldAutoFollow, setShouldAutoFollow] = useState(true);

  const activeControllerRef = useRef<AbortController | null>(null);
  const draftRef = useRef(INITIAL_PROMPT);
  const historyInitializedRef = useRef(false);
  const hasLocalSessionActivityRef = useRef(false);
  const loadedSessionIdsRef = useRef(new Set<string>());
  const loadingSessionIdsRef = useRef(new Set<string>());
  const streamingDraftBySessionRef = useRef<Record<string, StreamingDraft | undefined>>({
    [bootSession.id]: undefined,
  });
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
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
      const nextTimestamp = new Date().toISOString();
      const existing = current.find((session) => session.id === sessionId);
      if (!existing) {
        return sortSessionsByActivity([
          {
            id: sessionId,
            title,
            createdAt: nextTimestamp,
            updatedAt: nextTimestamp,
            lastMessageAt: nextTimestamp,
            isDraft: false,
          },
          ...current,
        ]);
      }

      return sortSessionsByActivity(
        current.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                title,
                updatedAt: nextTimestamp,
                lastMessageAt: nextTimestamp,
                isDraft: false,
              }
            : session,
        ),
      );
    });
  };

  const appendMessage = (sessionId: string, message: ChatMessage) => {
    setMessagesBySession((current) => ({
      ...current,
      [sessionId]: [...(current[sessionId] ?? []), message],
    }));
  };

  const updateStreamingDraft = (
    sessionId: string,
    updater: (current: StreamingDraft | undefined) => StreamingDraft | undefined,
  ) => {
    setStreamingDraftBySession((current) => {
      const next = {
        ...current,
        [sessionId]: updater(current[sessionId]),
      };
      streamingDraftBySessionRef.current = next;
      return next;
    });
  };

  const clearStreamingDraft = (sessionId: string) => {
    updateStreamingDraft(sessionId, () => undefined);
  };

  const setStreamingDraftStatus = (sessionId: string, nextStatus: StreamingDraft["status"]) => {
    updateStreamingDraft(sessionId, (current) =>
      current ? { ...current, status: nextStatus } : current,
    );
  };

  const setStreamingDraftTrace = (sessionId: string, trace: AgentRunTrace) => {
    updateStreamingDraft(sessionId, (current) => {
      const draftState = createThoughtDraft(current);
      return {
        ...draftState,
        trace,
      };
    });
  };

  const appendThought = (
    sessionId: string,
    activity: ActivityItem,
    statusOverride?: StreamingDraft["status"],
  ) => {
    updateStreamingDraft(sessionId, (current) => {
      const draftState = createThoughtDraft(current);
      return {
        ...draftState,
        status: statusOverride ?? draftState.status,
        thoughts: [...(draftState.thoughts ?? []).slice(-(MAX_THOUGHT_STEPS - 1)), activity],
      };
    });
  };

  const markLocalSessionActivity = () => {
    hasLocalSessionActivityRef.current = true;
  };

  const setComposerDraft = (value: string) => {
    draftRef.current = value;
    if (hasComposerDraft(value)) {
      markLocalSessionActivity();
    }
    setDraft(value);
  };

  const markSessionAsLoaded = (sessionId: string) => {
    loadedSessionIdsRef.current.add(sessionId);
  };

  const markSessionAsNeedingReload = (sessionId: string) => {
    loadedSessionIdsRef.current.delete(sessionId);
    loadingSessionIdsRef.current.delete(sessionId);
  };

  useEffect(() => {
    let cancelled = false;

    const loadSessions = async () => {
      try {
        const response = await fetch("/api/chat/sessions?limit=50");

        if (response.status === 401) {
          window.location.assign("/login");
          return;
        }

        if (!response.ok) {
          const errorMessage = await getErrorMessageFromResponse(
            response,
            "历史会话加载失败。",
          );
          if (!cancelled) {
            setStatus(errorMessage);
          }
          return;
        }

        const payload = (await response.json()) as ChatSessionsResponse;
        if (cancelled || historyInitializedRef.current) {
          return;
        }

        historyInitializedRef.current = true;

        if (
          shouldPreserveLocalSessionState({
            hasLocalSessionActivity: hasLocalSessionActivityRef.current,
            draft: draftRef.current,
          })
        ) {
          setSessions((current) => mergePersistedSessions(payload.items, current));
        } else {
          const nextState = buildInitialSessionList(payload.items, bootSession);
          setSessions(nextState.sessions);
          setActiveSessionId(nextState.activeSessionId);

          if (payload.items.length > 0) {
            setMessagesBySession({});
            setStreamingDraftBySession({});
            streamingDraftBySessionRef.current = {};
            loadedSessionIdsRef.current = new Set();
            loadingSessionIdsRef.current = new Set();
          }
        }

        setStatus("企业知识助手已就绪");
      } catch {
        if (!cancelled) {
          setStatus("历史会话加载失败。");
        }
      }
    };

    void loadSessions();

    return () => {
      cancelled = true;
    };
  }, [bootSession]);

  useEffect(() => {
    const activeSession = sessions.find((session) => session.id === activeSessionId);
    if (!activeSession || activeSession.isDraft) {
      return;
    }

    if (
      loadedSessionIdsRef.current.has(activeSessionId) ||
      loadingSessionIdsRef.current.has(activeSessionId)
    ) {
      return;
    }

    let cancelled = false;
    loadingSessionIdsRef.current.add(activeSessionId);

    const loadMessages = async () => {
      try {
        const response = await fetch(buildChatSessionMessagesPath(activeSessionId));

        if (response.status === 401) {
          window.location.assign("/login");
          return;
        }

        if (!response.ok) {
          const errorMessage = await getErrorMessageFromResponse(
            response,
            "历史消息加载失败。",
          );
          if (!cancelled) {
            setStatus(errorMessage);
          }
          return;
        }

        const payload = (await response.json()) as ChatSessionMessagesResponse;
        if (cancelled) {
          return;
        }

        setMessagesBySession((current) => ({
          ...current,
          [activeSessionId]: payload.items,
        }));
        setSessions((current) =>
          sortSessionsByActivity(
            current.map((session) =>
              session.id === payload.session.id
                ? {
                    ...session,
                    ...payload.session,
                    isDraft: false,
                  }
                : session,
            ),
          ),
        );
        markSessionAsLoaded(activeSessionId);
        setStatus("历史消息已加载");
      } catch {
        if (!cancelled) {
          setStatus("历史消息加载失败。");
        }
      } finally {
        loadingSessionIdsRef.current.delete(activeSessionId);
      }
    };

    void loadMessages();

    return () => {
      cancelled = true;
    };
  }, [activeSessionId, sessions]);

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
    activeStreamingDraft?.thoughts?.length,
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
      setStreamingDraftStatus(runSessionId, "stopped");
    }
  };

  const handleEvent = (sessionId: string, event: AgentStreamEvent) => {
    if (event.type === "run_started") {
      setActiveRun({ sessionId, runId: event.runId });
      appendThought(
        sessionId,
        createActivity(
          "run",
          "开始思考",
          "正在准备本轮上下文与执行路线。",
          `运行 ID: ${event.runId}`,
        ),
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
      appendThought(
        sessionId,
        createActivity(
          "memory",
          event.degraded ? "复用记忆摘要" : "更新记忆摘要",
          localizeTraceText(event.message),
          event.summary,
        ),
      );
      return;
    }

    if (event.type === "tool_started") {
      if (isKnowledgeBaseToolEvent(event)) {
        return;
      }

      appendThought(
        sessionId,
        createActivity(
          "tool-started",
          formatToolStartedTitle(event.toolCall),
          "已开始执行这一步。",
          safeJson(event.toolCall.input),
        ),
      );
      return;
    }

    if (event.type === "tool_progress") {
      if (isKnowledgeBaseToolEvent(event)) {
        return;
      }

      const progressMessage = formatToolProgressMessage(event.progress);
      appendThought(
        sessionId,
        createActivity(
          "tool-progress",
          progressMessage,
          localizeTraceText(event.progress.detail ?? "正在处理中。"),
        ),
      );
      setStatus(progressMessage);
      return;
    }

    if (event.type === "tool_result") {
      if (isKnowledgeBaseToolEvent(event)) {
        return;
      }

      const resultSummary = formatToolResultSummary(event.toolResult);
      appendThought(
        sessionId,
        createActivity(
          "tool-result",
          formatToolResultTitle(event.toolResult),
          resultSummary,
          formatToolResultDetail(event.toolResult),
        ),
      );
      setStatus(resultSummary);
      return;
    }

    if (event.type === "rag_step") {
      appendThought(sessionId, createRagStepActivity(event.step));
      setStatus(event.step.label);
      return;
    }

    if (event.type === "trace") {
      setStreamingDraftTrace(sessionId, event.trace);
      return;
    }

    if (event.type === "assistant_started") {
      appendThought(
        sessionId,
        createActivity("run", "组织回答", "正在整理检索结果并生成最终回复。"),
      );
      setStatus("正在生成回答...");
      return;
    }

    if (event.type === "assistant_delta") {
      updateStreamingDraft(sessionId, (current) => {
        const draftState = createThoughtDraft(current);
        return {
          ...draftState,
          content: `${draftState.content}${event.delta}`,
          status: "streaming",
        };
      });
      return;
    }

    if (event.type === "assistant_final") {
      const currentDraft = streamingDraftBySessionRef.current[sessionId];
      const resolved = resolveAssistantFinalMessage({
        draftContent: currentDraft?.content,
        finalMessage: event.message,
      });

      clearStreamingDraft(sessionId);
      appendMessage(
        sessionId,
        attachAssistantMetadataToMessage({
          message: resolved.message,
          thoughts: currentDraft?.thoughts ?? [],
          trace:
            currentDraft?.trace ??
            ((resolved.message.metadata as Record<string, unknown> | undefined)?.trace as
              | AgentRunTrace
              | undefined),
        }),
      );
      setStatus("回答完成");
      return;
    }

    if (event.type === "assistant_aborted") {
      appendThought(
        sessionId,
        createActivity("run", "已停止生成", localizeTraceText(event.message)),
        "stopped",
      );
      setStatus("已停止");
      setActiveRun(null);
      activeControllerRef.current = null;
      return;
    }

    if (event.type === "error") {
      const formatted = formatErrorMessage(event.message);
      const currentDraft = streamingDraftBySessionRef.current[sessionId];

      setStatus(formatted);
      clearStreamingDraft(sessionId);
      appendMessage(
        sessionId,
        attachAssistantMetadataToMessage({
          message: createLocalMessage("assistant", formatted, {
            kind: "system-error",
          }),
          thoughts: currentDraft?.thoughts ?? [],
          trace: currentDraft?.trace,
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

    markLocalSessionActivity();
    const sessionId = activeSessionId;
    const controller = new AbortController();
    activeControllerRef.current = controller;
    markSessionAsLoaded(sessionId);
    clearStreamingDraft(sessionId);
    setProviderLabel("OpenAI Compatible");
    setStatus("正在提交请求...");
    setShouldAutoFollow(true);

    const userMessage = createLocalMessage("user", content);
    appendMessage(sessionId, userMessage);
    upsertSession(sessionId, getChatSessionTitle(content));
    setComposerDraft("");

    try {
      let receivedDoneEvent = false;
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

      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }

      if (!response.ok || !response.body) {
        markSessionAsNeedingReload(sessionId);
        setStatus(
          await getErrorMessageFromResponse(response, "无法连接到 /api/chat"),
        );
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
          if (event.type === "done") {
            receivedDoneEvent = true;
          }
          handleEvent(sessionId, event);
        }
      }
      if (!receivedDoneEvent) {
        markSessionAsNeedingReload(sessionId);
        setActiveRun(null);
        activeControllerRef.current = null;
      }
    } catch (error) {
      markSessionAsNeedingReload(sessionId);
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("已停止");
        return;
      }

      const message = "请求没有顺利完成，请稍后重试。";
      const currentDraft = streamingDraftBySessionRef.current[sessionId];

      setStatus(message);
      clearStreamingDraft(sessionId);
      appendMessage(
        sessionId,
        attachAssistantMetadataToMessage({
          message: createLocalMessage("assistant", message, {
            kind: "system-error",
          }),
          thoughts: currentDraft?.thoughts ?? [],
          trace: currentDraft?.trace,
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

    markLocalSessionActivity();
    startTransition(() => {
      const session = createSession();
      markSessionAsNeedingReload(session.id);
      setSessions((current) => [session, ...current]);
      setActiveSessionId(session.id);
      setMessagesBySession((current) => ({
        ...current,
        [session.id]: [],
      }));
      setStreamingDraftBySession((current) => {
        const next = {
          ...current,
          [session.id]: undefined,
        };
        streamingDraftBySessionRef.current = next;
        return next;
      });
      setStatus("已新建一条知识会话。");
      setComposerDraft("");
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
    setComposerDraft(prompt);
    focusComposer();
  };

  const handleComposerKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
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
    sessions.find((session) => session.id === activeSessionId)?.title ??
    DEFAULT_CHAT_SESSION_TITLE;

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
              onChange={setComposerDraft}
              onKeyDown={handleComposerKeyDown}
              onStop={stopCurrentRun}
              onSubmit={() => void submitPrompt()}
              textareaRef={textareaRef}
            />
          </section>
        </div>
      </main>
    </div>
  );
}
