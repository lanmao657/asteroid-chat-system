import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schemaSource = readFileSync(new URL("./schema.ts", import.meta.url), "utf8");
const initSqlSource = readFileSync(new URL("../../../sql/init-postgres.sql", import.meta.url), "utf8");

const EMBEDDING_UPGRADE_STATEMENTS = [
  "ADD COLUMN IF NOT EXISTS embedding_vector JSONB;",
  "ADD COLUMN IF NOT EXISTS embedding_provider TEXT;",
  "ADD COLUMN IF NOT EXISTS embedding_model TEXT;",
  "ADD COLUMN IF NOT EXISTS embedding_dimensions INTEGER;",
  "ADD COLUMN IF NOT EXISTS embedding_error_message TEXT;",
];

describe("knowledge schema SQL", () => {
  it("keeps embedding upgrade statements aligned between runtime schema and init script", () => {
    for (const statement of EMBEDDING_UPGRADE_STATEMENTS) {
      expect(schemaSource).toContain(statement);
      expect(initSqlSource).toContain(statement);
    }
  });
});
