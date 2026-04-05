import { describe, expect, it } from "vitest";

import { resolveAssistantFinalMessage } from "./chat-stream";

describe("resolveAssistantFinalMessage", () => {
  it("keeps the longer streaming draft when final content is shorter", () => {
    const result = resolveAssistantFinalMessage({
      draftContent: "this is a much longer streamed answer",
      finalMessage: {
        id: "a1",
        role: "assistant",
        content: "this is shorter",
        createdAt: new Date().toISOString(),
      },
    });

    expect(result.usedDraft).toBe(true);
    expect(result.message.content).toBe("this is a much longer streamed answer");
    expect(result.message.metadata?.protectedLongDraft).toBe(true);
  });

  it("keeps the final message when it is not shorter than the draft", () => {
    const result = resolveAssistantFinalMessage({
      draftContent: "short",
      finalMessage: {
        id: "a2",
        role: "assistant",
        content: "this is the final answer",
        createdAt: new Date().toISOString(),
      },
    });

    expect(result.usedDraft).toBe(false);
    expect(result.message.content).toBe("this is the final answer");
  });
});
