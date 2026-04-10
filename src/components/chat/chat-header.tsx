import { MessageSquarePlus, PanelLeftOpen } from "lucide-react";

import styles from "@/components/chat-workspace.module.css";

interface ChatHeaderProps {
  onCreateSession: () => void;
  onExpandSidebar: () => void;
  providerLabel: string;
  sidebarCollapsed: boolean;
  status: string;
  title: string;
}

export function ChatHeader({
  onCreateSession,
  onExpandSidebar,
  providerLabel,
  sidebarCollapsed,
  status,
  title,
}: ChatHeaderProps) {
  return (
    <header className={styles.topbar}>
      <div className={styles.topbarGroup}>
        {sidebarCollapsed ? (
          <button
            aria-label="展开侧边栏"
            className={styles.iconButton}
            onClick={onExpandSidebar}
            type="button"
          >
            <PanelLeftOpen size={16} />
          </button>
        ) : null}

        <div className={styles.topbarMeta}>
          <div className={styles.topbarEyebrow}>Asteroid</div>
          <div className={styles.topbarTitleRow}>
            <h1 className={styles.topbarTitle}>{title}</h1>
            <span className={styles.providerPill}>{providerLabel}</span>
          </div>
        </div>
      </div>

      <div className={styles.topbarActions}>
        <div className={styles.statusBadge}>{status}</div>
        <button className={styles.secondaryButton} onClick={onCreateSession} type="button">
          <MessageSquarePlus size={16} />
          <span>新建对话</span>
        </button>
      </div>
    </header>
  );
}
