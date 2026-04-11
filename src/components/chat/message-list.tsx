import type { ReactNode, RefObject } from "react";

import { ChatMessageContent } from "@/components/chat-message-content";
import { ThinkingBlock } from "@/components/chat/thinking-block";
import styles from "@/components/chat-workspace.module.css";
import {
  getMessageThoughts,
  type MessageListItem,
  type StreamingDraft,
} from "@/components/chat/types";

interface MessageListProps {
  emptyState: ReactNode;
  formatTime: (value: string | number) => string;
  messages: MessageListItem[];
  timelineRef: RefObject<HTMLDivElement | null>;
  streamingDraft?: StreamingDraft;
}

const ROLE_LABELS = {
  assistant: "北境助手",
  user: "你",
} as const;

export function MessageList({
  emptyState,
  formatTime,
  messages,
  streamingDraft,
  timelineRef,
}: MessageListProps) {
  const isEmpty = messages.length === 0 && !streamingDraft;

  return (
    <div className={styles.timeline} ref={timelineRef} tabIndex={0}>
      {isEmpty ? (
        emptyState
      ) : (
        <div className={styles.timelineInner}>
          {messages.map((message) => (
            <article className={styles.message} data-role={message.role} key={message.id}>
              <div className={styles.messageMeta}>
                <span>{ROLE_LABELS[message.role]}</span>
                <span>{formatTime(message.createdAt)}</span>
              </div>
              {message.role === "assistant" ? (
                <ThinkingBlock formatTime={formatTime} thoughts={getMessageThoughts(message)} />
              ) : null}
              <ChatMessageContent content={message.content} role={message.role} />
            </article>
          ))}

          {streamingDraft ? (
            <article className={styles.message} data-role="assistant">
              <div className={styles.messageMeta}>
                <span>
                  北境助手
                  {streamingDraft.status === "stopped" ? " · 已停止生成" : ""}
                </span>
                <span>{formatTime(streamingDraft.createdAt)}</span>
              </div>
              <ThinkingBlock
                formatTime={formatTime}
                isStreaming={streamingDraft.status === "streaming"}
                thoughts={streamingDraft.thoughts ?? []}
              />
              <ChatMessageContent
                content={streamingDraft.content || "正在生成内容..."}
                role="assistant"
              />
            </article>
          ) : null}
        </div>
      )}
    </div>
  );
}
