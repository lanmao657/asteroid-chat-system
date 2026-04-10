import type { RefObject, ReactNode } from "react";

import { ChatMessageContent } from "@/components/chat-message-content";
import styles from "@/components/chat-workspace.module.css";
import type { MessageListItem, StreamingDraft } from "@/components/chat/types";

interface MessageListProps {
  emptyState: ReactNode;
  formatTime: (value: string | number) => string;
  messages: MessageListItem[];
  timelineRef: RefObject<HTMLDivElement | null>;
  streamingDraft?: StreamingDraft;
}

const ROLE_LABELS = {
  assistant: "Asteroid",
  user: "You",
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
              <ChatMessageContent content={message.content} role={message.role} />
            </article>
          ))}

          {streamingDraft ? (
            <article className={styles.message} data-role="assistant">
              <div className={styles.messageMeta}>
                <span>
                  Asteroid
                  {streamingDraft.status === "stopped" ? " · 已停止生成" : ""}
                </span>
                <span>{formatTime(streamingDraft.createdAt)}</span>
              </div>
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
