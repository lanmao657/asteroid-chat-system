import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/knowledge/knowledge-workspace", () => ({
  KnowledgeWorkspace: ({ presentation }: { presentation?: string }) => (
    <div data-presentation={presentation ?? "page"}>knowledge-workspace</div>
  ),
}));

vi.mock("@/components/auth/sign-out-button", () => ({
  SignOutButton: () => <button type="button">sign-out-button</button>,
}));

import { SettingsPage } from "@/components/settings/settings-page";

describe("SettingsPage", () => {
  it("renders document management by default with concise navigation", () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        currentUser={{
          email: "teammate@example.com",
          name: "Teammate",
        }}
      />,
    );

    expect(html).toContain('data-presentation="page"');
    expect(html).toContain('data-active-category="files"');
    expect(html).toContain("\u5317\u8fb0\u77e5\u8bc6\u52a9\u624b");
    expect(html).toContain("\u6587\u6863\u7ba1\u7406");
    expect(html).toContain("\u8d26\u53f7\u4fe1\u606f");
    expect(html).toContain("knowledge-workspace");
    expect(html).toContain('data-presentation="settings"');
    expect(html).not.toContain("sign-out-button");
    expect(html).not.toContain("\u4fdd\u62a4\u4f60\u7684\u8d26\u53f7");
  });

  it("switches to the account panel when account is the initial section", () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        currentUser={{
          email: "teammate@example.com",
          name: "Teammate",
        }}
        initialSection="account"
        presentation="modal"
      />,
    );

    expect(html).toContain('data-presentation="modal"');
    expect(html).toContain('data-active-category="account"');
    expect(html).toContain("\u8d26\u53f7\u4fe1\u606f");
    expect(html).toContain("\u8d26\u53f7");
    expect(html).toContain("Teammate");
    expect(html).toContain("teammate@example.com");
    expect(html).toContain("\u5df2\u767b\u5f55");
    expect(html).toContain("sign-out-button");
    expect(html).not.toContain("knowledge-workspace");
  });
});
