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
      <div className={styles.emptyStateEyebrow}>北辰知识助手</div>
      <h2 className={styles.emptyStateTitle}>今天要查制度、学流程，还是整理培训资料？</h2>
      <p className={styles.emptyStateBody}>
        这里保留现有的 agent、检索和工具能力，但默认围绕企业培训、制度问答、SOP 查询和案例复盘来组织工作流。
      </p>

      <PromptSuggestions onSelectSuggestion={onSelectSuggestion} suggestions={suggestions} />
    </div>
  );
}
