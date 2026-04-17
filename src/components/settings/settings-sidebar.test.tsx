import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  SETTINGS_CATEGORIES,
  type SettingsCategoryKey,
} from "@/components/settings/settings-data";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";

describe("SettingsSidebar", () => {
  it("renders chinese navigation and keeps the active item highlighted", () => {
    const html = renderToStaticMarkup(
      <SettingsSidebar
        activeCategory={"files" satisfies SettingsCategoryKey}
        categories={SETTINGS_CATEGORIES}
        onSelect={() => {}}
      />,
    );

    expect(html).toContain("设置导航");
    expect(html).toContain("文档管理");
    expect(html).toContain("账号信息");
    expect(html).not.toContain("Account");
    expect(html).not.toContain("Files");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('role="tablist"');
  });
});
