import styles from "@/components/chat-workspace.module.css";
import { PromptSuggestions } from "@/components/chat/prompt-suggestions";
import type { PromptSuggestion } from "@/components/chat/types";

interface EmptyStateProps {
  onSelectSuggestion: (prompt: string) => void;
  suggestions: PromptSuggestion[];
}

export function EmptyState({ onSelectSuggestion, suggestions }: EmptyStateProps) {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyStateEyebrow}>Asteroid Chat</div>
      <h2 className={styles.emptyStateTitle}>今天想让 Asteroid 帮你处理什么？</h2>
      <p className={styles.emptyStateBody}>
        这里保留你现有的 agent、检索和工具能力，只把桌面端首页重构成更简洁、更产品化的聊天工作台。
      </p>

      <PromptSuggestions onSelectSuggestion={onSelectSuggestion} suggestions={suggestions} />
    </div>
  );
}
