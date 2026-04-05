import { describe, expect, it } from "vitest";

import {
  getPresentationStyleInstruction,
  isPresentationIntent,
} from "./presentation";

describe("presentation intent helpers", () => {
  it("detects presentation-like requests", () => {
    expect(isPresentationIntent("请给我一个 10分钟 的课堂汇报 outline")).toBe(true);
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
