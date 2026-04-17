import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { KnowledgeWorkspace } from "@/components/knowledge/knowledge-workspace";

describe("KnowledgeWorkspace", () => {
  it("renders chinese upload and list management copy without detail panels", () => {
    const html = renderToStaticMarkup(<KnowledgeWorkspace embedded />);

    expect(html).toContain("上传文档");
    expect(html).toContain("已上传文档");
    expect(html).toContain("刷新列表");
    expect(html).toContain("暂时还没有文档");
    expect(html).not.toContain("Chunks");
    expect(html).not.toContain("extracted_text");
    expect(html).not.toContain("Document details");
  });
});
