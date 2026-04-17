import type { ReactNode, RefObject } from "react";

import { ChatMessageContent } from "@/components/chat-message-content";
import { getThinkingPhase, ThinkingBlock } from "@/components/chat/thinking-block";
import styles from "@/components/chat-workspace.module.css";
import {
  getMessageCitations,
  getMessageThoughts,
  getMessageTrace,
  type MessageListItem,
  type StreamingDraft,
} from "@/components/chat/types";
import type { AssistantCitation } from "@/lib/agent/types";

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

const INLINE_CITATION_LIMIT = 3;

function CitationList({ citations }: { citations: AssistantCitation[] }) {
  if (citations.length === 0) {
    return null;
  }

  const visible = citations.slice(0, INLINE_CITATION_LIMIT);
  const hidden = citations.slice(INLINE_CITATION_LIMIT);

  return (
    <div className={styles.citationBlock}>
      <div className={styles.citationTitle}>来源引用</div>
      <div className={styles.citationList}>
        {visible.map((citation) => (
          <div className={styles.citationCard} key={citation.citationId}>
            <div className={styles.citationCardHeader}>
              <span className={styles.citationDocumentTitle}>{citation.documentTitle}</span>
              <span className={styles.citationMeta}>片段 #{citation.chunkIndex + 1}</span>
            </div>
            <div className={styles.citationSnippet}>{citation.snippet}</div>
          </div>
        ))}
      </div>
      {hidden.length > 0 ? (
        <details className={styles.citationMore}>
          <summary className={styles.citationMoreSummary}>
            查看更多来源 ({hidden.length})
          </summary>
          <div className={styles.citationList}>
            {hidden.map((citation) => (
              <div className={styles.citationCard} key={citation.citationId}>
                <div className={styles.citationCardHeader}>
                  <span className={styles.citationDocumentTitle}>{citation.documentTitle}</span>
                  <span className={styles.citationMeta}>片段 #{citation.chunkIndex + 1}</span>
                </div>
                <div className={styles.citationSnippet}>{citation.snippet}</div>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

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
          {messages.map((message) => {
            const hasAssistantContent =
              message.role === "assistant" && message.content.trim().length > 0;
            const citations =
              message.role === "assistant" ? getMessageCitations(message) : [];

            return (
              <article className={styles.message} data-role={message.role} key={message.id}>
                <div className={styles.messageMeta}>
                  <span>{ROLE_LABELS[message.role]}</span>
                  <span>{formatTime(message.createdAt)}</span>
                </div>
                {message.role === "assistant" ? (
                  <div
                    className={styles.assistantBubble}
                    data-has-content={hasAssistantContent}
                    data-phase="complete"
                  >
                    <ThinkingBlock
                      formatTime={formatTime}
                      hasContent={hasAssistantContent}
                      thoughts={getMessageThoughts(message)}
                      trace={getMessageTrace(message)}
                    />
                    <ChatMessageContent content={message.content} role={message.role} />
                    <CitationList citations={citations} />
                  </div>
                ) : (
                  <ChatMessageContent content={message.content} role={message.role} />
                )}
              </article>
            );
          })}

          {streamingDraft
            ? (() => {
                const hasDraftContent = streamingDraft.content.trim().length > 0;
                const isStopped = streamingDraft.status === "stopped";
                const draftPhase = getThinkingPhase({
                  hasContent: hasDraftContent,
                  isStreaming: streamingDraft.status === "streaming",
                  isStopped,
                });

                return (
                  <article className={styles.message} data-role="assistant">
                    <div className={styles.messageMeta}>
                      <span>
                        {ROLE_LABELS.assistant}
                        {isStopped ? " · 已停止生成" : ""}
                      </span>
                      <span>{formatTime(streamingDraft.createdAt)}</span>
                    </div>
                    <div
                      className={styles.assistantBubble}
                      data-has-content={hasDraftContent}
                      data-phase={draftPhase}
                    >
                      <ThinkingBlock
                        formatTime={formatTime}
                        hasContent={hasDraftContent}
                        isStopped={isStopped}
                        isStreaming={streamingDraft.status === "streaming"}
                        thoughts={streamingDraft.thoughts ?? []}
                        trace={streamingDraft.trace}
                      />
                      {hasDraftContent ? (
                        <ChatMessageContent content={streamingDraft.content} role="assistant" />
                      ) : isStopped ? (
                        <div className={styles.streamingStoppedNote}>
                          已停止，本次未生成正文内容。
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })()
            : null}
        </div>
      )}
    </div>
  );
}
