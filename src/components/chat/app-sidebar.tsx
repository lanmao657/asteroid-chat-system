import Link from "next/link";

import { MessageSquarePlus, PanelLeftClose, Search, Settings2, Sparkles } from "lucide-react";

import styles from "@/components/chat-workspace.module.css";
import type { SessionSummary } from "@/components/chat/types";

interface AppSidebarProps {
  activeSessionId: string;
  isCollapsed: boolean;
  isStreaming: boolean;
  onCollapse: () => void;
  onCreateSession: () => void;
  onSelectSession: (sessionId: string) => void;
  sessions: SessionSummary[];
  formatTime: (value: string | number) => string;
}

export function AppSidebar({
  activeSessionId,
  formatTime,
  isCollapsed,
  isStreaming,
  onCollapse,
  onCreateSession,
  onSelectSession,
  sessions,
}: AppSidebarProps) {
  return (
    <div className={styles.sidebarInner}>
      <div className={styles.sidebarSection}>
        <div className={styles.sidebarTop}>
          <div className={styles.brandBlock}>
            <div className={styles.logoMark}>
              <Sparkles size={16} strokeWidth={2.1} />
            </div>
          </div>

          <button
            aria-label={isCollapsed ? "展开侧边栏" : "收起侧边栏"}
            className={styles.iconButton}
            onClick={onCollapse}
            type="button"
          >
            <PanelLeftClose size={16} />
          </button>
        </div>

        <button
          className={styles.primarySidebarButton}
          disabled={isStreaming}
          onClick={onCreateSession}
          type="button"
        >
          <MessageSquarePlus size={16} />
          <span>新对话</span>
        </button>
      </div>

      <div className={styles.sidebarSection}>
        <div className={styles.sidebarLabel}>会话</div>
        <div className={styles.sessionList}>
          {sessions.map((session) => (
            <button
              className={styles.sessionButton}
              data-active={session.id === activeSessionId}
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              type="button"
            >
              <span className={styles.sessionIcon}>
                <Search size={14} />
              </span>
              <span className={styles.sessionContent}>
                <span className={styles.sessionName}>{session.title}</span>
                <span className={styles.sessionMeta}>{formatTime(session.updatedAt)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.sidebarFooter}>
        <Link className={styles.sidebarUtility} href="/settings">
          <span className={styles.sidebarUtilityIcon}>
            <Settings2 size={15} />
          </span>
          <span>设置</span>
        </Link>
      </div>
    </div>
  );
}
