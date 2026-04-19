import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { KnowledgeWorkspace } from "@/components/knowledge/knowledge-workspace";

describe("KnowledgeWorkspace", () => {
  it("renders concise upload and list actions in settings presentation", () => {
    const html = renderToStaticMarkup(<KnowledgeWorkspace presentation="settings" />);

    expect(html).toContain('data-presentation="settings"');
    expect(html).toContain("\u6587\u6863");
    expect(html).toContain("\u9009\u62e9\u6587\u4ef6");
    expect(html).toContain("\u4e0a\u4f20");
    expect(html).toContain("\u672a\u9009\u62e9\u6587\u4ef6");
    expect(html).toContain("\u5237\u65b0");
    expect(html).toContain("\u6682\u65e0\u6587\u6863");
    expect(html).not.toContain("\u7ba1\u7406\u4f60\u7684\u6587\u6863");
  });
});
