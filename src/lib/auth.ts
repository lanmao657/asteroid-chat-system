import "server-only";

import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { nextCookies } from "better-auth/next-js";

import { getAuthKyselyDb } from "@/lib/db/kysely";

const betterAuthUrl = process.env.BETTER_AUTH_URL?.trim();
const betterAuthSecret = process.env.BETTER_AUTH_SECRET?.trim();

if (!betterAuthUrl) {
  throw new Error("BETTER_AUTH_URL is required for authentication.");
}

if (!betterAuthSecret) {
  throw new Error("BETTER_AUTH_SECRET is required for authentication.");
}

export const auth = betterAuth({
  baseURL: betterAuthUrl,
  secret: betterAuthSecret,
  database: {
    db: getAuthKyselyDb(),
    type: "postgres",
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
  },
  plugins: [nextCookies()],
  trustedOrigins: [betterAuthUrl],
});

let authSchemaReadyPromise: Promise<void> | null = null;

const authSchemaInitErrorMessage =
  "Authentication requires a reachable PostgreSQL database. Check DATABASE_URL and that PostgreSQL is running.";

const ignorableMigrationErrorCodes = new Set(["42P07", "42710", "42701"]);

const getErrorCode = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return null;
  }

  const { code } = error as { code?: unknown };
  return typeof code === "string" ? code : null;
};

const isIgnorableMigrationError = (error: unknown): boolean => {
  if (error instanceof AggregateError) {
    return error.errors.length > 0 && error.errors.every(isIgnorableMigrationError);
  }

  const code = getErrorCode(error);
  if (code && ignorableMigrationErrorCodes.has(code)) {
    return true;
  }

  if (!error || typeof error !== "object") {
    return false;
  }

  const { message } = error as { message?: unknown };
  return typeof message === "string" && message.toLowerCase().includes("already exists");
};

export const ensureAuthSchema = async () => {
  if (!authSchemaReadyPromise) {
    authSchemaReadyPromise = Promise.resolve()
      .then(async () => {
        const { runMigrations } = await getMigrations(auth.options);

        try {
          await runMigrations();
        } catch (error) {
          if (isIgnorableMigrationError(error)) {
            return;
          }

          throw error;
        }
      })
      .then(() => undefined)
      .catch((error) => {
        console.error("Failed to initialize Better Auth schema.", error);
        authSchemaReadyPromise = null;
        throw new Error(authSchemaInitErrorMessage, {
          cause: error,
        });
      });
  }

  await authSchemaReadyPromise;
};

export type AppAuthSession = (typeof auth)["$Infer"]["Session"];

export { authSchemaInitErrorMessage, isIgnorableMigrationError };
