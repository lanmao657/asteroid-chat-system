import { describe, expect, it } from "vitest";

import {
  buildChatSessionMessagesPath,
  buildInitialSessionList,
  DEFAULT_CHAT_SESSION_TITLE,
  getChatSessionTitle,
  hasComposerDraft,
  mergePersistedSessions,
  shouldPreserveLocalSessionState,
} from "./sessions";

describe("chat session helpers", () => {
  it("prefers persisted history over the local draft when history exists", () => {
    const result = buildInitialSessionList(
      [
        {
          id: "session-2",
          updatedAt: "2026-04-12T01:00:00.000Z",
          lastMessageAt: "2026-04-12T01:00:00.000Z",
        },
        {
          id: "session-1",
          updatedAt: "2026-04-12T00:00:00.000Z",
          lastMessageAt: "2026-04-12T00:00:00.000Z",
        },
      ],
      {
        id: "draft-session",
        updatedAt: "2026-04-11T00:00:00.000Z",
        lastMessageAt: null,
      },
    );

    expect(result.activeSessionId).toBe("session-2");
    expect(result.sessions.map((session) => session.id)).toEqual(["session-2", "session-1"]);
  });

  it("keeps the local draft when no persisted history exists", () => {
    const draftSession = {
      id: "draft-session",
      updatedAt: "2026-04-11T00:00:00.000Z",
      lastMessageAt: null,
    };

    const result = buildInitialSessionList([], draftSession);

    expect(result.activeSessionId).toBe("draft-session");
    expect(result.sessions).toEqual([draftSession]);
  });

  it("merges missing persisted sessions without overwriting local session state", () => {
    const result = mergePersistedSessions(
      [
        {
          id: "persisted-2",
          updatedAt: "2026-04-12T02:00:00.000Z",
          lastMessageAt: "2026-04-12T02:00:00.000Z",
        },
        {
          id: "draft-session",
          updatedAt: "2026-04-12T01:00:00.000Z",
          lastMessageAt: "2026-04-12T01:00:00.000Z",
        },
      ],
      [
        {
          id: "draft-session",
          updatedAt: "2026-04-12T03:00:00.000Z",
          lastMessageAt: "2026-04-12T03:00:00.000Z",
        },
        {
          id: "local-only",
          updatedAt: "2026-04-12T04:00:00.000Z",
          lastMessageAt: "2026-04-12T04:00:00.000Z",
        },
      ],
    );

    expect(result.map((session) => session.id)).toEqual([
      "local-only",
      "draft-session",
      "persisted-2",
    ]);
    expect(result.find((session) => session.id === "draft-session")?.updatedAt).toBe(
      "2026-04-12T03:00:00.000Z",
    );
  });

  it("builds a message-history path with an encoded session id", () => {
    expect(buildChatSessionMessagesPath("a/b?c#d")).toBe(
      "/api/chat/sessions/a%2Fb%3Fc%23d/messages",
    );
  });

  it("derives the first-message title with truncation and fallback", () => {
    expect(getChatSessionTitle("   ")).toBe(DEFAULT_CHAT_SESSION_TITLE);
    expect(getChatSessionTitle("这是一个很长很长很长很长的标题测试消息")).toBe(
      "这是一个很长很长很长很长的标题测试消息",
    );
    expect(
      getChatSessionTitle(
        "这是一条会被截断的首条消息，因为它明显超过了第一阶段的标题长度上限。",
      ),
    ).toBe("这是一条会被截断的首条消息，因为它明显超过了第一...");
  });
  it("preserves local state when the composer already has a draft", () => {
    expect(hasComposerDraft("   ")).toBe(false);
    expect(hasComposerDraft("first prompt")).toBe(true);
    expect(
      shouldPreserveLocalSessionState({
        hasLocalSessionActivity: false,
        draft: "first prompt",
      }),
    ).toBe(true);
    expect(
      shouldPreserveLocalSessionState({
        hasLocalSessionActivity: false,
        draft: "   ",
      }),
    ).toBe(false);
  });
});
