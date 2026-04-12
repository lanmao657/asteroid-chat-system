import { beforeEach, describe, expect, it, vi } from "vitest";

const { isDatabaseConfiguredMock, listSessionsByUserMock, requireApiSessionMock } = vi.hoisted(
  () => ({
    isDatabaseConfiguredMock: vi.fn(),
    listSessionsByUserMock: vi.fn(),
    requireApiSessionMock: vi.fn(),
  }),
);

vi.mock("@/lib/auth/session", () => ({
  requireApiSession: requireApiSessionMock,
}));

vi.mock("@/lib/db/chat-session-repository", () => ({
  listSessionsByUser: listSessionsByUserMock,
}));

vi.mock("@/lib/db/env", () => ({
  DATABASE_NOT_CONFIGURED_MESSAGE: "DATABASE_URL is not configured on the server.",
  isDatabaseConfigured: isDatabaseConfiguredMock,
}));

import { GET } from "./route";

describe("GET /api/chat/sessions", () => {
  beforeEach(() => {
    isDatabaseConfiguredMock.mockReset();
    listSessionsByUserMock.mockReset();
    requireApiSessionMock.mockReset();

    requireApiSessionMock.mockResolvedValue({
      response: null,
      session: {
        user: {
          id: "user-1",
        },
      },
    });
    isDatabaseConfiguredMock.mockReturnValue(true);
  });

  it("returns the current user's chat sessions", async () => {
    listSessionsByUserMock.mockResolvedValueOnce([
      {
        id: "session-1",
        userId: "user-1",
        title: "第一个会话",
        summary: "",
        createdAt: "2026-04-12T00:00:00.000Z",
        updatedAt: "2026-04-12T01:00:00.000Z",
        lastMessageAt: "2026-04-12T01:00:00.000Z",
      },
    ]);

    const response = await GET(new Request("http://localhost/api/chat/sessions?limit=20"));

    expect(response.status).toBe(200);
    expect(listSessionsByUserMock).toHaveBeenCalledWith({
      userId: "user-1",
      limit: 20,
    });
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          id: "session-1",
          title: "第一个会话",
          createdAt: "2026-04-12T00:00:00.000Z",
          updatedAt: "2026-04-12T01:00:00.000Z",
          lastMessageAt: "2026-04-12T01:00:00.000Z",
        },
      ],
    });
  });

  it("uses the documented default limit when limit is omitted or invalid", async () => {
    listSessionsByUserMock.mockResolvedValue([]);

    await GET(new Request("http://localhost/api/chat/sessions"));
    expect(listSessionsByUserMock).toHaveBeenNthCalledWith(1, {
      userId: "user-1",
      limit: 50,
    });

    await GET(new Request("http://localhost/api/chat/sessions?limit=abc"));
    expect(listSessionsByUserMock).toHaveBeenNthCalledWith(2, {
      userId: "user-1",
      limit: 50,
    });
  });

  it("still clamps low and high limit values", async () => {
    listSessionsByUserMock.mockResolvedValue([]);

    await GET(new Request("http://localhost/api/chat/sessions?limit=0"));
    expect(listSessionsByUserMock).toHaveBeenNthCalledWith(1, {
      userId: "user-1",
      limit: 1,
    });

    await GET(new Request("http://localhost/api/chat/sessions?limit=999"));
    expect(listSessionsByUserMock).toHaveBeenNthCalledWith(2, {
      userId: "user-1",
      limit: 100,
    });
  });

  it("returns 503 when the database is unavailable", async () => {
    isDatabaseConfiguredMock.mockReturnValueOnce(false);

    const response = await GET(new Request("http://localhost/api/chat/sessions"));

    expect(response.status).toBe(503);
  });
});
