#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";

const url = required("LIBSQL_URL");
const authToken = process.env.LIBSQL_AUTH_TOKEN;
const schema = await readFile(
  new URL("../schema.sql", import.meta.url),
  "utf8",
);

const client = createClient({ url, authToken });

// Only control-plane tables (worlds_metadata, api_keys) belong in the control
// database. Per-world data tables (quads/chunks/fts) live in each provisioned
// world database via initializeWorldDatabase; an existing shared-libsql control
// DB may still contain legacy copies with a different shape, so never re-apply
// statements for them.
const controlStatements = schema
  .split(/;\s*(?:\r?\n|$)/)
  .map((sql) => sql.trim())
  .filter((sql) => /worlds_metadata|api_keys/.test(sql));

// Idempotent upgrades for databases created before the world_uid schema.
// These must run before the purge index (which references the new columns).
await addColumnIfMissing(
  "worlds_metadata",
  "purge_status",
  "TEXT NOT NULL DEFAULT 'none'",
);
await addColumnIfMissing("worlds_metadata", "purged_at", "TEXT");

// Rebuild the legacy worlds_metadata table. The old schema had a NOT NULL
// world_id column and a UNIQUE(namespace, world_id) constraint, both of which
// reject world_uid inserts. Preserve all rows and drop world_id.
if (await hasColumn("worlds_metadata", "world_id")) {
  await client.executeMultiple(`
    CREATE TABLE worlds_metadata_new (
      uid TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'active',
      database_url TEXT,
      database_auth_token TEXT,
      embedding_model TEXT NOT NULL DEFAULT 'tfjs-universal-sentence-encoder',
      chunk_size INTEGER NOT NULL DEFAULT 1000,
      top_k INTEGER NOT NULL DEFAULT 20,
      min_score REAL NOT NULL DEFAULT 0.0,
      delete_time TEXT,
      expire_time TEXT,
      purge_status TEXT NOT NULL DEFAULT 'none',
      purged_at TEXT,
      create_time TEXT NOT NULL,
      update_time TEXT NOT NULL
    );
    INSERT INTO worlds_metadata_new (uid, namespace, display_name, state, database_url, database_auth_token, embedding_model, chunk_size, top_k, min_score, delete_time, expire_time, purge_status, purged_at, create_time, update_time)
      SELECT uid, namespace, display_name, state, database_url, database_auth_token, embedding_model, chunk_size, top_k, min_score, delete_time, expire_time, purge_status, purged_at, create_time, update_time FROM worlds_metadata;
    DROP TABLE worlds_metadata;
    ALTER TABLE worlds_metadata_new RENAME TO worlds_metadata;
  `);
}

// The remaining control-plane statements are idempotent (IF NOT EXISTS) and
// now have their columns, so apply them.
await client.batch(
  controlStatements.map((sql) => ({ sql })),
  "write",
);

console.log(`Applied control-plane schema to ${url}`);

async function tableExists(table) {
  const rs = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [table],
  );
  return rs.rows.length > 0;
}

async function hasColumn(table, column) {
  if (!(await tableExists(table))) return false;
  const rs = await client.execute(`PRAGMA table_info(${table})`);
  const names = rs.rows.map((row) => String(row[1]));
  return names.includes(column);
}

async function addColumnIfMissing(table, column, definition) {
  if (!(await tableExists(table))) return;
  if (await hasColumn(table, column)) return;
  await client.execute({
    sql: `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
  });
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Set ${name}`);
    process.exit(1);
  }
  return value;
}
