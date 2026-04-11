import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MessageList } from "@/components/chat/message-list";
import type { MessageListItem, StreamingDraft } from "@/components/chat/types";

const formatTime = () => "04-11 15:00";

describe("MessageList", () => {
  it("renders assistant history messages with a unified bubble and preserved thoughts", () => {
    const messages: MessageListItem[] = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "最终回答正文",
        createdAt: new Date().toISOString(),
        metadata: {
          thoughts: [
            {
              id: "thought-1",
              kind: "run",
              title: "Searching",
              body: "Searching the knowledge base.",
              createdAt: new Date().toISOString(),
            },
          ],
        },
      },
    ];

    const html = renderToStaticMarkup(
      <MessageList
        emptyState={<div>empty</div>}
        formatTime={formatTime}
        messages={messages}
        timelineRef={createRef<HTMLDivElement>()}
      />,
    );

    expect(html).toContain("assistantBubble");
    expect(html).toContain("思考过程");
    expect(html).toContain("最终回答正文");
  });

  it("shows the streaming draft as one assistant bubble that contains thought state and streamed content", () => {
    const streamingDraft: StreamingDraft = {
      id: "draft-1",
      content: "正在输出正文",
      status: "streaming",
      createdAt: new Date().toISOString(),
      thoughts: [
        {
          id: "thought-2",
          kind: "run",
          title: "Grading",
          body: "Checking whether the retrieved documents are sufficient.",
          createdAt: new Date().toISOString(),
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MessageList
        emptyState={<div>empty</div>}
        formatTime={formatTime}
        messages={[]}
        streamingDraft={streamingDraft}
        timelineRef={createRef<HTMLDivElement>()}
      />,
    );

    expect(html).toContain("思考过程");
    expect(html).toContain("回答中");
    expect(html).toContain("正在输出正文");
  });

  it("marks a stopped partial draft as stopped instead of complete", () => {
    const streamingDraft: StreamingDraft = {
      id: "draft-2",
      content: "已经输出了一半",
      status: "stopped",
      createdAt: new Date().toISOString(),
      thoughts: [
        {
          id: "thought-3",
          kind: "run",
          title: "Searching",
          body: "Searching the knowledge base.",
          createdAt: new Date().toISOString(),
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MessageList
        emptyState={<div>empty</div>}
        formatTime={formatTime}
        messages={[]}
        streamingDraft={streamingDraft}
        timelineRef={createRef<HTMLDivElement>()}
      />,
    );

    expect(html).toContain('data-phase="stopped"');
    expect(html).toContain("已停止生成");
    expect(html).toContain("已停止");
  });
});
