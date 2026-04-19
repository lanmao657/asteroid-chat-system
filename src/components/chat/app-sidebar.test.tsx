import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppSidebar } from "@/components/chat/app-sidebar";
import type { SessionSummary } from "@/components/chat/types";

describe("AppSidebar", () => {
  it("renders concise navigation entries", () => {
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

    expect(html).toContain("\u65b0\u5bf9\u8bdd");
    expect(html).toContain("\u4f1a\u8bdd");
    expect(html).toContain("\u8bbe\u7f6e");
    expect(html).toContain("/settings");
    expect(html).not.toContain("\u4f01\u4e1a\u57f9\u8bad\u3001\u5236\u5ea6\u95ee\u7b54\u4e0e\u5185\u90e8\u77e5\u8bc6\u68c0\u7d22\u5de5\u4f5c\u53f0");
  });
});
