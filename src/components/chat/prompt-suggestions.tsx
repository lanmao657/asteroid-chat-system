import { ArrowUpRight } from "lucide-react";

import styles from "@/components/chat-workspace.module.css";
import type { PromptSuggestion } from "@/components/chat/types";

interface PromptSuggestionsProps {
  onSelectSuggestion: (prompt: string) => void;
  suggestions: PromptSuggestion[];
}

export function PromptSuggestions({
  onSelectSuggestion,
  suggestions,
}: PromptSuggestionsProps) {
  return (
    <div className={styles.suggestionGrid}>
      {suggestions.map((suggestion) => (
        <button
          className={styles.suggestionCard}
          key={suggestion.id}
          onClick={() => onSelectSuggestion(suggestion.prompt)}
          type="button"
        >
          <div className={styles.suggestionCardTop}>
            <div className={styles.suggestionTitle}>{suggestion.title}</div>
            <ArrowUpRight size={16} />
          </div>
          {suggestion.description ? (
            <div className={styles.suggestionDescription}>{suggestion.description}</div>
          ) : null}
        </button>
      ))}
    </div>
  );
}
