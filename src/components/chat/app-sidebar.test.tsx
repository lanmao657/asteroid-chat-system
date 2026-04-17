import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppSidebar } from "@/components/chat/app-sidebar";
import type { SessionSummary } from "@/components/chat/types";

describe("AppSidebar", () => {
  it("renders a settings entry and no longer shows account details or sign-out", () => {
    const sessions: SessionSummary[] = [
      {
        id: "session-1",
        title: "Recent session",
        updatedAt: new Date().toISOString(),
      },
    ];

    const html = renderToStaticMarkup(
      <AppSidebar
        activeSessionId="session-1"
        formatTime={() => "04-13 21:00"}
        isCollapsed={false}
        isStreaming={false}
        onCollapse={() => {}}
        onCreateSession={() => {}}
        onSelectSession={() => {}}
        sessions={sessions}
      />,
    );

    expect(html).toContain("设置");
    expect(html).toContain("/settings");
    expect(html).not.toContain("Account");
    expect(html).not.toContain("閫€鍑虹櫥褰?");
  });
});
