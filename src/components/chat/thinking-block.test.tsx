import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  getThinkingPhase,
  getThinkingStatusLabel,
  getThinkingSummaryText,
  ThinkingBlock,
} from "@/components/chat/thinking-block";
import type { ActivityItem } from "@/components/chat/types";

const formatTime = () => "04-11 15:00";

const thoughts: ActivityItem[] = [
  {
    id: "step-1",
    kind: "run",
    title: "Searching",
    body: "Searching the knowledge base for relevant documents.",
    createdAt: new Date().toISOString(),
  },
  {
    id: "step-2",
    kind: "run",
    title: "Grading",
    body: "Checking whether the retrieved documents are sufficient.",
    createdAt: new Date().toISOString(),
  },
];

describe("ThinkingBlock", () => {
  it("derives the correct thinking phases", () => {
    expect(getThinkingPhase({ hasContent: false, isStreaming: true })).toBe("thinking");
    expect(getThinkingPhase({ hasContent: true, isStreaming: true })).toBe("responding");
    expect(getThinkingPhase({ hasContent: false, isStreaming: false })).toBe("stopped");
    expect(getThinkingPhase({ hasContent: true, isStreaming: false })).toBe("complete");
    expect(
      getThinkingPhase({ hasContent: true, isStopped: true, isStreaming: false }),
    ).toBe("stopped");
  });

  it("formats the thinking summary for the responding state", () => {
    expect(
      getThinkingSummaryText({
        latestThoughtTitle: "Grading",
        phase: "responding",
        thoughtCount: 2,
      }),
    ).toContain("已切入回答");
    expect(getThinkingStatusLabel("responding")).toBe("回答中");
  });

  it("renders an expanded thinking list before content starts streaming", () => {
    const html = renderToStaticMarkup(
      <ThinkingBlock
        defaultExpanded
        formatTime={formatTime}
        hasContent={false}
        isStreaming
        thoughts={thoughts}
      />,
    );

    expect(html).toContain("思考过程");
    expect(html).toContain("思考中");
    expect(html).toContain("Searching");
    expect(html).toContain("Grading");
  });

  it("renders a compact responding header once content exists", () => {
    const html = renderToStaticMarkup(
      <ThinkingBlock
        formatTime={formatTime}
        hasContent
        isStreaming
        thoughts={thoughts}
      />,
    );

    expect(html).toContain("回答中");
    expect(html).toContain("已切入回答");
    expect(html).not.toContain("Checking whether the retrieved documents are sufficient.");
  });

  it("renders stopped state even when partial content already exists", () => {
    const html = renderToStaticMarkup(
      <ThinkingBlock
        formatTime={formatTime}
        hasContent
        isStopped
        thoughts={thoughts}
      />,
    );

    expect(html).toContain("已停止");
    expect(html).toContain("已停止生成");
  });
});
