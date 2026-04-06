const asNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const dbEnv = {
  databaseUrl: process.env.DATABASE_URL?.trim() ?? "",
  maxConnections: asNumber(process.env.DATABASE_MAX_CONNECTIONS, 5),
  idleTimeoutMs: asNumber(process.env.DATABASE_IDLE_TIMEOUT_MS, 30_000),
  connectionTimeoutMs: asNumber(process.env.DATABASE_CONNECTION_TIMEOUT_MS, 5_000),
};

export const isDatabaseConfigured = () => Boolean(dbEnv.databaseUrl);
