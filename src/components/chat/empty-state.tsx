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
      <h2 className={styles.emptyStateTitle}>开始提问</h2>
      <PromptSuggestions onSelectSuggestion={onSelectSuggestion} suggestions={suggestions} />
    </div>
  );
}
