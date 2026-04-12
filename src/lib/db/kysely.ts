import "server-only";

import { Kysely, PostgresDialect } from "kysely";

import { getDbPool } from "@/lib/db/client";

let db: Kysely<unknown> | null = null;

export const getAuthKyselyDb = () => {
  if (db) {
    return db;
  }

  const pool = getDbPool();
  if (!pool) {
    throw new Error("DATABASE_URL is required for authentication.");
  }

  db = new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool,
    }),
  });

  return db;
};
