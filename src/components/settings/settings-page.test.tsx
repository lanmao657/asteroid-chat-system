import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/knowledge/knowledge-workspace", () => ({
  KnowledgeWorkspace: ({ embedded }: { embedded?: boolean }) => (
    <div data-embedded={embedded ? "true" : "false"}>knowledge-workspace</div>
  ),
}));

vi.mock("@/components/auth/sign-out-button", () => ({
  SignOutButton: () => <button type="button">sign-out-button</button>,
}));

import { SettingsPage } from "@/components/settings/settings-page";

describe("SettingsPage", () => {
  it("renders a chinese document workspace with account information on the same page", () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        currentUser={{
          email: "teammate@example.com",
          name: "Teammate",
        }}
      />,
    );

    expect(html).toContain("设置");
    expect(html).toContain("文档管理");
    expect(html).toContain("账号信息");
    expect(html).toContain("knowledge-workspace");
    expect(html).toContain('data-embedded="true"');
    expect(html).toContain("sign-out-button");
    expect(html).toContain("Teammate");
    expect(html).toContain("teammate@example.com");
    expect(html).not.toContain("Settings");
    expect(html).not.toContain("Account");
    expect(html).not.toContain("Files");
  });

  it("keeps both sections visible even when account is the current focus", () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        currentUser={{
          email: "teammate@example.com",
          name: "Teammate",
        }}
        initialSection="account"
      />,
    );

    expect(html).toContain("当前定位：账号信息");
    expect(html).toContain("文档管理");
    expect(html).toContain("账号信息");
    expect(html).toContain("knowledge-workspace");
    expect(html).toContain("sign-out-button");
  });
});
