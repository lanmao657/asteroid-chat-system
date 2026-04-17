import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("ensureAuthSchema", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { getMigrations } = await import("better-auth/db/migration");
    vi.mocked(getMigrations).mockReset();
  });

  it("wraps migration discovery failures with a clear database error", async () => {
    const { getMigrations } = await import("better-auth/db/migration");
    vi.mocked(getMigrations).mockRejectedValueOnce(
      new AggregateError([new Error("connect ECONNREFUSED 127.0.0.1:5432")]),
    );

    const { ensureAuthSchema, authSchemaInitErrorMessage } = await import("./auth");

    await expect(ensureAuthSchema()).rejects.toMatchObject({
      message: authSchemaInitErrorMessage,
    });
  });

  it("wraps migration execution failures with a clear database error", async () => {
    const { getMigrations } = await import("better-auth/db/migration");
    vi.mocked(getMigrations).mockResolvedValueOnce({
      toBeCreated: [],
      toBeAdded: [],
      runMigrations: vi.fn(async () => {
        throw new Error("connection refused");
      }),
      compileMigrations: vi.fn(async () => ""),
    });

    const { ensureAuthSchema, authSchemaInitErrorMessage } = await import("./auth");

    await expect(ensureAuthSchema()).rejects.toMatchObject({
      message: authSchemaInitErrorMessage,
    });
  });
});

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
