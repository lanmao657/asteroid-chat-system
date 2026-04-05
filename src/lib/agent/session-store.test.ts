import { beforeEach, describe, expect, it } from "vitest";

import {
  appendSessionMessage,
  clearSessions,
  ensureSession,
  getSessionMemorySummary,
  listSessionMessages,
  setSessionMemorySummary,
} from "./session-store";

describe("session-store", () => {
  beforeEach(() => {
    clearSessions();
  });

  it("creates and reuses sessions", () => {
    const first = ensureSession("alpha");
    const second = ensureSession("alpha");

    expect(first.id).toBe("alpha");
    expect(second).toBe(first);
  });

  it("returns cloned messages instead of the live references", () => {
    appendSessionMessage("alpha", {
      id: "1",
      role: "user",
      content: "hello",
      createdAt: new Date().toISOString(),
      metadata: { flag: true },
    });

    const firstRead = listSessionMessages("alpha");
    firstRead[0].content = "mutated";

    const secondRead = listSessionMessages("alpha");
    expect(secondRead[0].content).toBe("hello");
  });

  it("stores memory summary separately from formal messages", () => {
    setSessionMemorySummary("alpha", "summary text");
    appendSessionMessage("alpha", {
      id: "1",
      role: "assistant",
      content: "final answer",
      createdAt: new Date().toISOString(),
    });

    expect(getSessionMemorySummary("alpha")).toBe("summary text");
    expect(listSessionMessages("alpha")).toHaveLength(1);
  });
});
