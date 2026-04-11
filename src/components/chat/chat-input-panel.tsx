import type { KeyboardEventHandler, RefObject } from "react";

import { ArrowUp, Square } from "lucide-react";

import styles from "@/components/chat-workspace.module.css";

interface ChatInputPanelProps {
  draft: string;
  isStreaming: boolean;
  onChange: (value: string) => void;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  onSubmit: () => void;
  onStop: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export function ChatInputPanel({
  draft,
  isStreaming,
  onChange,
  onKeyDown,
  onStop,
  onSubmit,
  textareaRef,
}: ChatInputPanelProps) {
  return (
    <section className={styles.composerDock}>
      <div className={styles.composerSurface}>
        <div className={styles.composerPrompt}>向北辰知识助手提问</div>
        <textarea
          className={styles.textarea}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="输入你的问题，例如：报销流程怎么走、根据客服 SOP 回答退款争议，或整理入职培训清单。"
          ref={textareaRef}
          rows={1}
          value={draft}
        />

        <div className={styles.composerFooter}>
          <div className={styles.composerHint}>
            {isStreaming ? "正在流式生成中，点击右侧可随时停止。" : "按 Cmd/Ctrl + Enter 发送"}
          </div>

          <button
            className={styles.sendButton}
            disabled={!isStreaming && !draft.trim()}
            onClick={isStreaming ? onStop : onSubmit}
            type="button"
          >
            {isStreaming ? <Square size={15} /> : <ArrowUp size={15} />}
            <span>{isStreaming ? "停止生成" : "发送"}</span>
          </button>
        </div>
      </div>
    </section>
  );
}
