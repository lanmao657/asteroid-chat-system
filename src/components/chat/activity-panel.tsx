import { ChevronDown, Sparkles, WandSparkles } from "lucide-react";
import { useState } from "react";

import styles from "@/components/chat-workspace.module.css";
import type { ActivityItem } from "@/components/chat/types";

interface ActivityPanelProps {
  activities: ActivityItem[];
  formatTime: (value: string | number) => string;
  status: string;
}

export function ActivityPanel({ activities, formatTime, status }: ActivityPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const recentActivities = activities.slice(-6).reverse();
  const latestActivity = recentActivities[0];

  return (
    <aside className={styles.activityPanel}>
      <div className={styles.activityPanelHeader}>
        <div className={styles.activityTitle}>轨迹</div>
        <button
          aria-expanded={isExpanded}
          className={styles.activityToggle}
          onClick={() => setIsExpanded((current) => !current)}
          type="button"
        >
          <span>{isExpanded ? "收起" : "展开"}</span>
          <ChevronDown className={styles.activityToggleIcon} data-open={isExpanded} size={16} />
        </button>
      </div>

      <div className={styles.activitySummary}>
        <div className={styles.activitySummaryIcon}>
          {activities.length > 0 ? <Sparkles size={16} /> : <WandSparkles size={16} />}
        </div>
        <div className={styles.activitySummaryBody}>
          <div className={styles.activitySummaryTitle}>
            {latestActivity?.title ?? "暂无记录"}
          </div>
          <div className={styles.activitySummaryText}>{latestActivity?.body ?? status}</div>
        </div>
      </div>

      {isExpanded ? (
        <div className={styles.activityList}>
          {recentActivities.length > 0 ? (
            recentActivities.map((activity) => (
              <article className={styles.activityItem} key={activity.id}>
                <div className={styles.activityItemMeta}>
                  <span>{activity.title}</span>
                  <span>{formatTime(activity.createdAt)}</span>
                </div>
                <div className={styles.activityItemBody}>{activity.body}</div>
                {activity.detail ? (
                  <pre className={styles.activityItemDetail}>{activity.detail}</pre>
                ) : null}
              </article>
            ))
          ) : (
            <div className={styles.activityEmpty}>暂无记录</div>
          )}
        </div>
      ) : null}
    </aside>
  );
}
