"use client";

import { ChevronDown, Sparkles } from "lucide-react";
import { useState } from "react";

import styles from "@/components/chat-workspace.module.css";
import type { AgentRunTrace } from "@/lib/agent/types";
import type { ActivityItem } from "@/components/chat/types";

interface ThinkingBlockProps {
  defaultExpanded?: boolean;
  formatTime: (value: string | number) => string;
  hasContent?: boolean;
  isStreaming?: boolean;
  isStopped?: boolean;
  thoughts: ActivityItem[];
  trace?: AgentRunTrace;
}

type ThinkingPhase = "thinking" | "responding" | "stopped" | "complete";

const ROUTE_LABELS: Record<NonNullable<AgentRunTrace["route"]>, string> = {
  web: "联网检索",
  "knowledge-base": "知识库检索",
  weather: "天气查询",
  none: "直接回答",
};

export const getThinkingPhase = ({
  hasContent,
  isStreaming,
  isStopped = false,
}: {
  hasContent: boolean;
  isStreaming: boolean;
  isStopped?: boolean;
}): ThinkingPhase => {
  if (isStopped) {
    return "stopped";
  }
  if (isStreaming && !hasContent) {
    return "thinking";
  }
  if (isStreaming && hasContent) {
    return "responding";
  }
  if (!isStreaming && !hasContent) {
    return "stopped";
  }
  return "complete";
};

export const getThinkingSummaryText = ({
  latestThoughtTitle,
  phase,
  thoughtCount,
}: {
  latestThoughtTitle?: string;
  phase: ThinkingPhase;
  thoughtCount: number;
}) => {
  if (phase === "thinking") {
    return latestThoughtTitle
      ? `正在思考 · ${thoughtCount} 步 · ${latestThoughtTitle}`
      : "正在思考 · 等待第一条步骤";
  }

  if (phase === "responding") {
    return latestThoughtTitle
      ? `已切入回答 · 保留 ${thoughtCount} 步记录 · ${latestThoughtTitle}`
      : "已切入回答 · 保留思考记录";
  }

  if (phase === "stopped") {
    return latestThoughtTitle
      ? `已停止生成 · 共 ${thoughtCount} 步 · ${latestThoughtTitle}`
      : "已停止生成 · 未输出正文";
  }

  return latestThoughtTitle
    ? `思考完成 · ${thoughtCount} 步 · ${latestThoughtTitle}`
    : "本条回答没有可展示的思考过程";
};

export const getThinkingStatusLabel = (phase: ThinkingPhase) => {
  if (phase === "thinking") {
    return "思考中";
  }
  if (phase === "responding") {
    return "回答中";
  }
  if (phase === "stopped") {
    return "已停止";
  }
  return "已完成";
};

const getTraceMetaText = (trace?: AgentRunTrace) => {
  if (!trace) {
    return "";
  }

  const route = ROUTE_LABELS[trace.route];
  const docCount = trace.retrievedDocuments.length;
  if (trace.rewrite?.query && trace.finalQuery !== trace.originalQuery) {
    return `${route} · 改写后命中 ${docCount} 个结果`;
  }

  return `${route} · 命中 ${docCount} 个结果`;
};

export function ThinkingBlock({
  defaultExpanded,
  formatTime,
  hasContent = false,
  isStreaming = false,
  isStopped = false,
  thoughts,
  trace,
}: ThinkingBlockProps) {
  const [userExpanded, setUserExpanded] = useState<boolean | null>(
    defaultExpanded ?? null,
  );

  if (thoughts.length === 0) {
    return null;
  }

  const latestThought = thoughts[thoughts.length - 1];
  const phase = getThinkingPhase({ hasContent, isStreaming, isStopped });
  const autoExpanded = isStreaming && !hasContent;
  const resolvedExpanded = userExpanded ?? autoExpanded;
  const summary = getThinkingSummaryText({
    latestThoughtTitle: latestThought?.title,
    phase,
    thoughtCount: thoughts.length,
  });
  const traceMetaText = getTraceMetaText(trace);

  return (
    <section
      className={styles.thinkingBlock}
      data-has-content={hasContent}
      data-phase={phase}
      data-streaming={isStreaming}
    >
      <button
        aria-expanded={resolvedExpanded}
        className={styles.thinkingToggle}
        data-phase={phase}
        data-streaming={isStreaming}
        onClick={() => {
          setUserExpanded((current) => !(current ?? autoExpanded));
        }}
        type="button"
      >
        <span className={styles.thinkingToggleIcon} data-phase={phase}>
          <Sparkles size={15} />
        </span>
        <span className={styles.thinkingToggleBody}>
          <span className={styles.thinkingToggleHeaderRow}>
            <span className={styles.thinkingToggleTitle}>思考过程</span>
            <span className={styles.thinkingStatusPill} data-phase={phase}>
              <span className={styles.thinkingStatusDot} data-phase={phase} />
              {getThinkingStatusLabel(phase)}
            </span>
          </span>
          <span className={styles.thinkingToggleSummary}>{summary}</span>
          {traceMetaText ? (
            <span className={styles.thinkingTraceMeta}>{traceMetaText}</span>
          ) : null}
        </span>
        <ChevronDown
          className={styles.thinkingToggleChevron}
          data-open={resolvedExpanded}
          size={16}
        />
      </button>

      {resolvedExpanded ? (
        <div className={styles.thinkingList}>
          {thoughts.map((thought, index) => {
            const isLatest = index === thoughts.length - 1;
            return (
              <article
                className={styles.thinkingItem}
                data-current={isStreaming && isLatest}
                key={thought.id}
              >
                <div className={styles.thinkingItemMeta}>
                  <span>{thought.title}</span>
                  <span>{formatTime(thought.createdAt)}</span>
                </div>
                <div className={styles.thinkingItemBody}>{thought.body}</div>
                {thought.detail ? (
                  <pre className={styles.thinkingItemDetail}>{thought.detail}</pre>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
