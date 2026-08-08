#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client/web";

const url = required("LIBSQL_URL");
const authToken = process.env.LIBSQL_AUTH_TOKEN;
const schema = await readFile(new URL("../schema.sql", import.meta.url), "utf8");
const statements = schema
  .split(/;\s*(?:\r?\n|$)/)
  .map((sql) => sql.trim())
  .filter(Boolean);

const client = createClient({ url, authToken });
await client.batch(statements.map((sql) => ({ sql })), "write");

// Idempotent upgrades for databases created before the world_uid schema.
// These fail harmlessly when the column already exists (fresh schema).
for (const alter of [
  "ALTER TABLE worlds_metadata ADD COLUMN purge_status TEXT NOT NULL DEFAULT 'none'",
  "ALTER TABLE worlds_metadata ADD COLUMN purged_at TEXT",
  "CREATE INDEX IF NOT EXISTS idx_worlds_metadata_purge ON worlds_metadata(purge_status, expire_time) WHERE state = 'deleted'",
]) {
  try {
    await client.execute({ sql: alter });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/duplicate column name/i.test(message)) {
      throw err;
    }
  }
}

console.log(`Applied ${statements.length} schema statements to ${url}`);

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Set ${name}`);
    process.exit(1);
  }
  return value;
}
