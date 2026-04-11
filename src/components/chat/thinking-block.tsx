"use client";

import { ChevronDown, Sparkles } from "lucide-react";
import { useState } from "react";

import styles from "@/components/chat-workspace.module.css";
import type { ActivityItem } from "@/components/chat/types";

interface ThinkingBlockProps {
  formatTime: (value: string | number) => string;
  isStreaming?: boolean;
  thoughts: ActivityItem[];
}

const getSummaryText = (thoughts: ActivityItem[], isStreaming: boolean) => {
  const latestThought = thoughts[thoughts.length - 1];
  if (!latestThought) {
    return isStreaming ? "正在整理思路..." : "本条回答没有可展示的过程信息";
  }

  const prefix = isStreaming ? "正在思考" : "已完成思考";
  return `${prefix} · ${thoughts.length} 步 · ${latestThought.title}`;
};

export function ThinkingBlock({
  formatTime,
  isStreaming = false,
  thoughts,
}: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (thoughts.length === 0) {
    return null;
  }

  return (
    <section className={styles.thinkingBlock}>
      <button
        aria-expanded={isExpanded}
        className={styles.thinkingToggle}
        onClick={() => setIsExpanded((current) => !current)}
        type="button"
      >
        <span className={styles.thinkingToggleIcon}>
          <Sparkles size={15} />
        </span>
        <span className={styles.thinkingToggleBody}>
          <span className={styles.thinkingToggleTitle}>思考过程</span>
          <span className={styles.thinkingToggleSummary}>{getSummaryText(thoughts, isStreaming)}</span>
        </span>
        <ChevronDown
          className={styles.thinkingToggleChevron}
          data-open={isExpanded}
          size={16}
        />
      </button>

      {isExpanded ? (
        <div className={styles.thinkingList}>
          {thoughts.map((thought) => (
            <article className={styles.thinkingItem} key={thought.id}>
              <div className={styles.thinkingItemMeta}>
                <span>{thought.title}</span>
                <span>{formatTime(thought.createdAt)}</span>
              </div>
              <div className={styles.thinkingItemBody}>{thought.body}</div>
              {thought.detail ? (
                <pre className={styles.thinkingItemDetail}>{thought.detail}</pre>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
