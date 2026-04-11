import { describe, expect, it } from "vitest";

import {
  getDirectScriptStyleInstruction,
  getPresentationStyleInstruction,
  isDirectScriptIntent,
  isPresentationIntent,
} from "./presentation";

describe("presentation intent helpers", () => {
  it("detects presentation-like requests", () => {
    expect(isPresentationIntent("请给我一个10分钟的课堂汇报 outline")).toBe(true);
    expect(isPresentationIntent("Write a presentation for class")).toBe(true);
  });

  it("does not force presentation mode for ordinary questions", () => {
    expect(isPresentationIntent("什么是 React")).toBe(false);
    expect(getPresentationStyleInstruction("常见前端技术有哪些")).toBe("");
  });

  it("returns style guidance for presentation requests", () => {
    const instruction = getPresentationStyleInstruction(
      "请帮我准备一个 database systems 课堂 presentation",
    );

    expect(instruction).toContain("presentation-ready");
    expect(instruction).toContain("trade-offs");
  });
});

describe("direct script intent helpers", () => {
  it("detects direct-script requests", () => {
    expect(isDirectScriptIntent("客户投诉时客服应该怎么回复？请给出标准说法")).toBe(true);
    expect(isDirectScriptIntent("请给业务一段标准回复话术")).toBe(true);
  });

  it("does not trigger direct-script mode for ordinary sop questions", () => {
    expect(isDirectScriptIntent("退款争议处理 SOP 的流程是什么")).toBe(false);
    expect(getDirectScriptStyleInstruction("退款争议处理 SOP 的流程是什么")).toBe("");
  });

  it("returns style guidance for direct-script requests", () => {
    const instruction = getDirectScriptStyleInstruction(
      "客户因为退款慢而投诉时，客服应该怎么回复？给出标准回复。",
    );

    expect(instruction).toContain("标准话术");
    expect(instruction).toContain("directly copyable");
  });
});
