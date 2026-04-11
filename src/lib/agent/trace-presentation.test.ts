import { describe, expect, it } from "vitest";

import {
  formatRetrievalTrace,
  formatToolProgressMessage,
  formatToolResultDetail,
  formatToolResultSummary,
  formatToolResultTitle,
  localizeTraceText,
} from "./trace-presentation";
import type { RetrievalStep, ToolProgress, ToolResult } from "./types";

describe("trace-presentation", () => {
  it("localizes common runtime progress messages", () => {
    const progress: ToolProgress = {
      callId: "progress-1",
      tool: "knowledgeBaseSearch",
      message: "Rewriting -> step-back",
    };

    expect(formatToolProgressMessage(progress)).toBe("查询改写 -> Step-Back");
    expect(localizeTraceText("Routing -> knowledge-base")).toBe("路由判断 -> 知识库");
  });

  it("formats retrieval trace in Chinese", () => {
    const trace: RetrievalStep[] = [
      {
        stage: "routing",
        label: "Routing",
        detail: "Selected knowledge-base route for this turn.",
      },
      {
        stage: "completed",
        label: "Completed",
        detail: "Knowledge-base retrieval finished.",
      },
    ];

    expect(formatRetrievalTrace(trace)).toBe(
      ["1. 路由判断：本轮已选择知识库路线。", "2. 完成：知识库检索完成。"].join("\n"),
    );
  });

  it("prefers localized trace over raw detail in tool results", () => {
    const toolResult: ToolResult = {
      callId: "tool-1",
      tool: "knowledgeBaseSearch",
      phase: "search",
      status: "success",
      summary: "Knowledge-base retrieval completed with 2 candidate(s); grading decision: answer.",
      payload: [],
      provider: "knowledge-base",
      detail: "{\"decision\":\"answer\"}",
      trace: [
        {
          stage: "routing",
          label: "Routing",
          detail: "Selected knowledge-base route for this turn.",
        },
      ],
    };

    expect(formatToolResultTitle(toolResult)).toBe("知识库检索 · 知识库 · 成功");
    expect(formatToolResultSummary(toolResult)).toBe(
      "知识库检索完成，共获得 2 个候选结果；评估结论：直接回答。",
    );
    expect(formatToolResultDetail(toolResult)).toBe("1. 路由判断：本轮已选择知识库路线。");
  });
});
