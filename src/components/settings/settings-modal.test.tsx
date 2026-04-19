import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    back: vi.fn(),
    push: vi.fn(),
  }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => (
    <div data-open={open}>{children}</div>
  ),
  DialogContent: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => (
    <div className={className} data-slot="dialog-content">
      {children}
    </div>
  ),
  DialogHeader: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className} data-slot="dialog-header">
      {children}
    </div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => (
    <div data-slot="dialog-title">{children}</div>
  ),
}));

vi.mock("@/components/knowledge/knowledge-workspace", () => ({
  KnowledgeWorkspace: ({ presentation }: { presentation?: string }) => (
    <div data-presentation={presentation ?? "page"}>knowledge-workspace</div>
  ),
}));

vi.mock("@/components/auth/sign-out-button", () => ({
  SignOutButton: () => <button type="button">sign-out-button</button>,
}));

import { SettingsModal } from "@/components/settings/settings-modal";

describe("SettingsModal", () => {
  it("renders an accessible modal shell with concise sidebar copy", () => {
    const html = renderToStaticMarkup(
      <SettingsModal
        currentUser={{
          email: "teammate@example.com",
          name: "Teammate",
        }}
      />,
    );

    expect(html).toContain('data-slot="dialog-content"');
    expect(html).toContain('data-slot="dialog-title"');
    expect(html).toContain("\u8bbe\u7f6e");
    expect(html).toContain('aria-label="\u5173\u95ed\u8bbe\u7f6e"');
    expect(html).toContain('data-presentation="modal"');
    expect(html).toContain("knowledge-workspace");
  });
});
