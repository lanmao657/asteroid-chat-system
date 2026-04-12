import { describe, expect, it, vi } from "vitest";

process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.BETTER_AUTH_SECRET ??= "test-secret";

vi.mock("server-only", () => ({}));

vi.mock("better-auth", () => ({
  betterAuth: vi.fn((options) => ({
    options,
    api: {
      getSession: vi.fn(),
    },
  })),
}));

vi.mock("better-auth/db/migration", () => ({
  getMigrations: vi.fn(),
}));

vi.mock("better-auth/next-js", () => ({
  nextCookies: vi.fn(() => "next-cookies-plugin"),
}));

vi.mock("@/lib/db/kysely", () => ({
  getAuthKyselyDb: vi.fn(() => ({ mocked: true })),
}));

describe("isIgnorableMigrationError", () => {
  it("ignores duplicate relation errors from concurrent auth migrations", async () => {
    const { isIgnorableMigrationError } = await import("./auth");

    expect(isIgnorableMigrationError({ code: "42P07" })).toBe(true);
    expect(isIgnorableMigrationError({ code: "42710" })).toBe(true);
    expect(isIgnorableMigrationError({ code: "42701" })).toBe(true);
    expect(isIgnorableMigrationError(new AggregateError([{ code: "42P07" }]))).toBe(true);
  });

  it("does not ignore unrelated database errors", async () => {
    const { isIgnorableMigrationError } = await import("./auth");

    expect(isIgnorableMigrationError({ code: "23505" })).toBe(false);
    expect(isIgnorableMigrationError(new Error("connection refused"))).toBe(false);
  });
});
