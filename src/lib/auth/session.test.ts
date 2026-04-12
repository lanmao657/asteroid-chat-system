import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensureAuthSchemaMock, getSessionMock, headersMock, redirectMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  headersMock: vi.fn(async () => new Headers()),
  redirectMock: vi.fn(),
  ensureAuthSchemaMock: vi.fn(async () => undefined),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  headers: headersMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
  ensureAuthSchema: ensureAuthSchemaMock,
}));

import {
  getSession,
  getSessionFromHeaders,
  getSessionOrRedirect,
  redirectIfAuthenticated,
  requireApiSession,
} from "./session";

describe("auth session helpers", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    headersMock.mockClear();
    redirectMock.mockReset();
    ensureAuthSchemaMock.mockClear();
  });

  it("returns the current session from request headers", async () => {
    const session = {
      session: { id: "session-1" },
      user: { id: "user-1", email: "user@example.com", name: "Lan Mao" },
    };
    getSessionMock.mockResolvedValueOnce(session);

    await expect(getSession()).resolves.toEqual(session);
    expect(ensureAuthSchemaMock).toHaveBeenCalledTimes(1);
    expect(headersMock).toHaveBeenCalledTimes(1);
    expect(getSessionMock).toHaveBeenCalledTimes(1);
  });

  it("redirects guests when a protected page requires a session", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    await getSessionOrRedirect();

    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("redirects authenticated users away from auth pages", async () => {
    getSessionMock.mockResolvedValueOnce({
      session: { id: "session-2" },
      user: { id: "user-2", email: "user@example.com", name: "Lan Mao" },
    });

    await redirectIfAuthenticated();

    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("returns a 401 response for protected API requests without a session", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const result = await requireApiSession(new Request("http://localhost/api/demo"));

    expect(result.session).toBeNull();
    expect(result.response?.status).toBe(401);
  });

  it("passes the session through for protected API requests", async () => {
    const session = {
      session: { id: "session-3" },
      user: { id: "user-3", email: "user@example.com", name: "Lan Mao" },
    };
    getSessionMock.mockResolvedValue(session);

    const result = await requireApiSession(new Request("http://localhost/api/demo"));
    const fromHeaders = await getSessionFromHeaders(new Headers());

    expect(result.response).toBeNull();
    expect(result.session).toEqual(session);
    expect(fromHeaders).toEqual(session);
  });
});
