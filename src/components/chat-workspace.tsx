"use client";

import { startTransition, useDeferredValue, useRef, useState } from "react";

import styles from "@/components/chat-workspace.module.css";
import type { AgentStreamEvent, ChatMessage, ToolResult } from "@/lib/agent/types";

interface SessionSummary {
  id: string;
  title: string;
  updatedAt: number;
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

const sessionTitleFrom = (message: string) => {
  const compact = message.trim().replace(/\s+/g, " ");
  return compact.length > 24 ? `${compact.slice(0, 24)}...` : compact || "新对话";
};

const describeToolResult = (toolResult: ToolResult) => {
  const provider = toolResult.provider ? ` · ${toolResult.provider}` : "";
  const errorTag =
    toolResult.status === "error" && toolResult.errorType
      ? ` · ${toolResult.errorType}`
      : "";

  return `${toolResult.tool}${provider}${errorTag}: ${toolResult.summary}`;
};

export function ChatWorkspace() {
  const [bootSession] = useState<SessionSummary>(() => createSession());
  const [sessions, setSessions] = useState<SessionSummary[]>(() => [bootSession]);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => bootSession.id);
  const [messagesBySession, setMessagesBySession] = useState<
    Record<string, ChatMessage[]>
  >(() => ({ [bootSession.id]: [] }));
  const [toolResultsBySession, setToolResultsBySession] = useState<
    Record<string, ToolResult[]>
  >(() => ({ [bootSession.id]: [] }));
  const [draft, setDraft] = useState(INITIAL_PROMPT);
  const [status, setStatus] = useState("准备就绪。");
  const [providerLabel, setProviderLabel] = useState("未连接");
  const [isStreaming, setIsStreaming] = useState(false);
  const assistantDraftRef = useRef<{ id: string; sessionId: string } | null>(null);

  const activeMessages = messagesBySession[activeSessionId] ?? [];
  const deferredMessages = useDeferredValue(activeMessages);
  const latestToolSummary = (toolResultsBySession[activeSessionId] ?? []).slice(-4);

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

  const updateAssistantDraft = (sessionId: string, delta: string) => {
    const currentDraft = assistantDraftRef.current;
    if (!currentDraft || currentDraft.sessionId !== sessionId) {
      const message = createLocalMessage("assistant", delta);
      assistantDraftRef.current = { id: message.id, sessionId };
      appendMessage(sessionId, message);
      return;
    }

    setMessagesBySession((current) => ({
      ...current,
      [sessionId]: (current[sessionId] ?? []).map((message) =>
        message.id === currentDraft.id
          ? { ...message, content: `${message.content}${delta}` }
          : message,
      ),
    }));
  };

  const finalizeAssistantDraft = (sessionId: string, message: ChatMessage) => {
    const currentDraft = assistantDraftRef.current;
    if (!currentDraft || currentDraft.sessionId !== sessionId) {
      appendMessage(sessionId, message);
      return;
    }

    setMessagesBySession((current) => ({
      ...current,
      [sessionId]: (current[sessionId] ?? []).map((entry) =>
        entry.id === currentDraft.id ? message : entry,
      ),
    }));
    assistantDraftRef.current = null;
  };

  const appendToolResult = (sessionId: string, toolResult: ToolResult) => {
    setToolResultsBySession((current) => ({
      ...current,
      [sessionId]: [...(current[sessionId] ?? []), toolResult],
    }));
    appendMessage(
      sessionId,
      createLocalMessage("tool", describeToolResult(toolResult), {
        tool: toolResult.tool,
        status: toolResult.status,
        provider: toolResult.provider,
        errorType: toolResult.errorType,
      }),
    );
  };

  const handleEvent = (sessionId: string, event: AgentStreamEvent) => {
    if (event.type === "session") {
      setProviderLabel(event.provider);
      setStatus(`已连接到 ${event.provider}`);
      return;
    }

    if (event.type === "tool_started") {
      setStatus(`${event.toolCall.tool} 正在执行...`);
      appendMessage(
        sessionId,
        createLocalMessage(
          "tool",
          `${event.toolCall.tool} 已启动：${JSON.stringify(event.toolCall.input)}`,
          { tool: event.toolCall.tool },
        ),
      );
      return;
    }

    if (event.type === "tool_result") {
      setStatus(event.toolResult.userMessage || event.toolResult.summary);
      appendToolResult(sessionId, event.toolResult);
      return;
    }

    if (event.type === "assistant_started") {
      setStatus("正在生成回答...");
      return;
    }

    if (event.type === "assistant_delta") {
      updateAssistantDraft(sessionId, event.delta);
      return;
    }

    if (event.type === "assistant_final") {
      finalizeAssistantDraft(sessionId, event.message);
      setStatus("回答完成。");
      return;
    }

    if (event.type === "error") {
      setStatus(event.message);
      assistantDraftRef.current = null;
      return;
    }

    if (event.type === "done") {
      setIsStreaming(false);
    }
  };

  const submitPrompt = async () => {
    const content = draft.trim();
    if (!content || !activeSessionId || isStreaming) {
      return;
    }

    const sessionId = activeSessionId;
    setIsStreaming(true);
    setStatus("正在提交请求...");
    assistantDraftRef.current = null;
    setToolResultsBySession((current) => ({
      ...current,
      [sessionId]: [],
    }));

    const userMessage = createLocalMessage("user", content);
    appendMessage(sessionId, userMessage);
    upsertSession(sessionId, sessionTitleFrom(content));
    setDraft("");

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        message: content,
      }),
    });

    if (!response.ok || !response.body) {
      setStatus("无法连接到 /api/chat");
      setIsStreaming(false);
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
        const lines = frame.split("\n");
        const eventLine = lines.find((line) => line.startsWith("event: "));
        const dataLine = lines.find((line) => line.startsWith("data: "));
        if (!eventLine || !dataLine) {
          continue;
        }

        const event = JSON.parse(dataLine.slice(6)) as AgentStreamEvent;
        handleEvent(sessionId, event);
      }
    }

    setIsStreaming(false);
  };

  const createFreshSession = () => {
    startTransition(() => {
      const session = createSession();
      setSessions((current) => [session, ...current]);
      setActiveSessionId(session.id);
      setMessagesBySession((current) => ({
        ...current,
        [session.id]: [],
      }));
      setToolResultsBySession((current) => ({
        ...current,
        [session.id]: [],
      }));
      setStatus("已新建一条对话。");
      setDraft("");
      assistantDraftRef.current = null;
    });
  };

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.logoRow}>
          <div className={styles.logoMark}>A</div>
          <div>
            <div className={styles.logoTitle}>Agent Workspace</div>
            <div className={styles.logoSub}>本地优先的智能体工作台</div>
          </div>
        </div>

        <button className={styles.newButton} onClick={createFreshSession} type="button">
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
            <span className={styles.eyebrow}>Research-first agent</span>
            <h1 className={styles.heroHeadline}>更清晰地提问，更可靠地获得线索。</h1>
            <p className={styles.heroBody}>
              像 ChatGPT 首页一样保持简洁、轻盈和明确层级，同时保留工具状态、对话上下文和流式回答。
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
              {deferredMessages.length === 0 ? (
                <div className={styles.empty}>
                  输入一个问题开始。如果问题涉及“最新、今天、新闻、current、latest”等词，
                  agent 会优先尝试实时检索。
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
                      <div className={styles.messageBody}>{message.content}</div>
                    </article>
                  ))}
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
              <div className={styles.sectionLabel}>Tools</div>
              <div className={styles.sectionTitle}>最近工具输出</div>
              <div className={styles.toolList}>
                {latestToolSummary.length === 0 ? (
                  <div className={styles.panelMuted}>
                    这里会展示最近一次搜索、抓取和过滤结果，方便快速判断 agent 在做什么。
                  </div>
                ) : (
                  latestToolSummary.map((toolResult) => (
                    <div className={styles.toolItem} key={toolResult.callId}>
                      <div className={styles.toolName}>
                        {toolResult.tool} · {toolResult.status}
                      </div>
                      <div className={styles.toolSummary}>{describeToolResult(toolResult)}</div>
                    </div>
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
                  void submitPrompt();
                }
              }}
              placeholder="输入你的问题，例如：帮我整理 AI agent 最近一周的重要动态"
              value={draft}
            />

            <div className={styles.composerFooter}>
              <div className={styles.composerHint}>
                {isStreaming ? "正在流式返回..." : "按 Cmd/Ctrl + Enter 发送"}
              </div>
              <button
                className={styles.sendButton}
                disabled={!activeSessionId || isStreaming || !draft.trim()}
                onClick={() => void submitPrompt()}
                type="button"
              >
                {isStreaming ? "生成中..." : "发送"}
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
