import { Pool } from "pg";

import { dbEnv, isDatabaseConfigured } from "@/lib/db/env";

let pool: Pool | null = null;

export const getDbPool = () => {
  if (!isDatabaseConfigured()) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: dbEnv.databaseUrl,
      max: dbEnv.maxConnections,
      idleTimeoutMillis: dbEnv.idleTimeoutMs,
      connectionTimeoutMillis: dbEnv.connectionTimeoutMs,
      allowExitOnIdle: true,
    });

    pool.on("error", (error) => {
      console.error("Unexpected PostgreSQL pool error:", error);
    });
  }

  return pool;
};
