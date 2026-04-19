import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  SETTINGS_CATEGORIES,
  type SettingsCategoryKey,
} from "@/components/settings/settings-data";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";

describe("SettingsSidebar", () => {
  it("renders only two settings categories with the close button and accessible navigation", () => {
    const html = renderToStaticMarkup(
      <SettingsSidebar
        activeCategory={"files" satisfies SettingsCategoryKey}
        categories={SETTINGS_CATEGORIES}
        onSelect={() => {}}
        onRequestClose={() => {}}
        presentation="modal"
      />,
    );

    expect(SETTINGS_CATEGORIES).toHaveLength(2);
    expect(html).toContain("设置导航");
    expect(html).toContain("文档管理");
    expect(html).toContain("账号信息");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="关闭设置"');
    expect(html).not.toContain("Settings");
    expect(html).not.toContain("鏂囨。");
  });
});
