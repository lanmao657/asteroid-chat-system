import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChatMessageContent } from "./chat-message-content";

describe("ChatMessageContent", () => {
  it("renders assistant markdown as structured HTML", () => {
    const html = renderToStaticMarkup(
      <ChatMessageContent
        content={"## 标题\n\n- 条目一\n- **条目二**"}
        role="assistant"
      />,
    );

    expect(html).toContain("<h2>标题</h2>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<strong>条目二</strong>");
  });

  it("keeps user content as plain text", () => {
    const html = renderToStaticMarkup(
      <ChatMessageContent
        content={"## 用户输入\n- 不应该解析"}
        role="user"
      />,
    );

    expect(html).toContain("## 用户输入");
    expect(html).not.toContain("<h2>");
    expect(html).not.toContain("<ul>");
  });
});
