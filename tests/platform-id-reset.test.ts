import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

describe("Worlds API clean reset", () => {
  it("drops application tables and leaves Cloudflare-managed storage intact", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB) WITHOUT ROWID;
        CREATE TABLE worlds (world_id TEXT PRIMARY KEY);
        CREATE TABLE api_keys (api_key_id TEXT PRIMARY KEY);
        CREATE TABLE quads (quad_id TEXT PRIMARY KEY);
        CREATE TABLE chunks (chunk_id INTEGER PRIMARY KEY AUTOINCREMENT);
        CREATE VIRTUAL TABLE chunks_fts USING fts5(fts_value, content='chunks', content_rowid='chunk_id');
        CREATE TABLE worlds_data_plane_schema (schema_version_id INTEGER PRIMARY KEY, version INTEGER NOT NULL UNIQUE, applied_at TEXT NOT NULL);
        CREATE TABLE worlds_metadata (world_id TEXT PRIMARY KEY);
        CREATE TABLE worlds_api_migrations (migration_id TEXT PRIMARY KEY);
      `);

      db.exec(
        readFileSync(
          "migrations/2026-09-27-platform-id-clean-reset.sql",
          "utf8",
        ),
      );

      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as Array<{ name: string }>;
      expect(tables.map((table) => table.name)).toEqual(["_cf_KV"]);
    } finally {
      db.close();
    }
  });
});
