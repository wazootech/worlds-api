import { DatabaseSync } from "node:sqlite";
import type { D1Database } from "@cloudflare/workers-types";
import { describe, expect, it } from "vitest";
import { ensureControlPlaneSchema } from "../src/lib/d1-schema";

function asD1Database(sqlite: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...values: unknown[]) {
          return {
            all: async <T>() => ({
              results: statement.all(...(values as never[])) as T[],
            }),
            first: async <T>() =>
              (statement.get(...(values as never[])) as T | undefined) ?? null,
            run: async () => ({
              meta: {
                changes: Number(statement.run(...(values as never[])).changes),
              },
            }),
          };
        },
        all: async <T>() => ({ results: statement.all() as T[] }),
        first: async <T>() => (statement.get() as T | undefined) ?? null,
        run: async () => ({
          meta: { changes: Number(statement.run().changes) },
        }),
      } as never;
    },
  } as unknown as D1Database;
}

function columnNames(sqlite: DatabaseSync, table: string): string[] {
  return sqlite
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => (column as { name: string }).name);
}

function rowCount(sqlite: DatabaseSync, table: string): number {
  return (
    sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    }
  ).count;
}

function foreignKeyReferences(sqlite: DatabaseSync, table: string) {
  return sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all() as {
    table: string;
    from: string;
    to: string;
  }[];
}

describe("control-plane identifier migration", () => {
  it("renames existing identifiers and preserves rows and world relationships", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE worlds (
        uid TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        display_name TEXT NOT NULL,
        state TEXT NOT NULL,
        embedding_model TEXT NOT NULL,
        chunk_size INTEGER NOT NULL,
        top_k INTEGER NOT NULL,
        min_score REAL NOT NULL,
        delete_time TEXT,
        expire_time TEXT,
        purge_status TEXT NOT NULL,
        purged_at TEXT,
        create_time TEXT NOT NULL,
        update_time TEXT NOT NULL
      );
      CREATE TABLE api_keys (
        uid TEXT PRIMARY KEY,
        key_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        namespace TEXT NOT NULL,
        world_id TEXT REFERENCES worlds(uid),
        scopes TEXT NOT NULL,
        create_time TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE TABLE worlds_metadata (uid TEXT PRIMARY KEY, namespace TEXT NOT NULL);
      CREATE TABLE quads (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        world_id TEXT NOT NULL REFERENCES worlds(uid),
        subject TEXT NOT NULL
      );
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        world_id TEXT NOT NULL REFERENCES worlds(uid),
        text TEXT NOT NULL
      );
      INSERT INTO worlds VALUES (
        'w_existing', 'user_existing', 'Existing world', 'active',
        'model', 1000, 20, 0.0, NULL, NULL, 'none', NULL,
        '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'
      );
      INSERT INTO api_keys VALUES (
        'key_existing', 'hash_existing', 'Read key', 'user_existing',
        'w_existing', '["data:read"]', '2026-09-01T00:00:00Z', NULL
      );
      INSERT INTO worlds_metadata VALUES ('w_existing', 'user_existing');
      INSERT INTO quads VALUES ('quad_existing', 'user_existing', 'w_existing', 'subject');
      INSERT INTO chunks VALUES ('chunk_existing', 'user_existing', 'w_existing', 'Existing data');
    `);
    const expectedCounts = new Map(
      ["worlds", "api_keys", "worlds_metadata", "quads", "chunks"].map(
        (table) => [table, rowCount(sqlite, table)],
      ),
    );

    try {
      await ensureControlPlaneSchema(asD1Database(sqlite));

      expect(columnNames(sqlite, "worlds")).toContain("world_id");
      expect(columnNames(sqlite, "worlds")).not.toContain("uid");
      expect(columnNames(sqlite, "api_keys")).toContain("api_key_id");
      expect(columnNames(sqlite, "api_keys")).not.toContain("uid");
      expect(columnNames(sqlite, "worlds_metadata")).toContain("world_id");
      expect(columnNames(sqlite, "worlds_metadata")).not.toContain("uid");
      expect(sqlite.prepare("SELECT * FROM worlds").get()).toMatchObject({
        world_id: "w_existing",
        namespace: "user_existing",
        display_name: "Existing world",
      });
      expect(sqlite.prepare("SELECT * FROM api_keys").get()).toMatchObject({
        api_key_id: "key_existing",
        world_id: "w_existing",
        key_hash: "hash_existing",
        scopes: '["data:read"]',
      });
      expect(
        sqlite.prepare("SELECT world_id FROM worlds_metadata").get(),
      ).toEqual({
        world_id: "w_existing",
      });
      expect(sqlite.prepare("SELECT world_id FROM quads").get()).toEqual({
        world_id: "w_existing",
      });
      expect(sqlite.prepare("SELECT world_id FROM chunks").get()).toEqual({
        world_id: "w_existing",
      });
      expect(foreignKeyReferences(sqlite, "api_keys")).toContainEqual(
        expect.objectContaining({
          table: "worlds",
          from: "world_id",
          to: "world_id",
        }),
      );
      expect(foreignKeyReferences(sqlite, "quads")).toContainEqual(
        expect.objectContaining({
          table: "worlds",
          from: "world_id",
          to: "world_id",
        }),
      );
      expect(foreignKeyReferences(sqlite, "chunks")).toContainEqual(
        expect.objectContaining({
          table: "worlds",
          from: "world_id",
          to: "world_id",
        }),
      );
      expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      for (const [table, count] of expectedCounts) {
        expect(rowCount(sqlite, table)).toBe(count);
      }

      await expect(
        ensureControlPlaneSchema(asD1Database(sqlite)),
      ).resolves.toBeUndefined();
    } finally {
      sqlite.close();
    }
  });

  it("fails closed when both previous and canonical columns exist", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE worlds (uid TEXT, world_id TEXT, namespace TEXT, state TEXT,
        display_name TEXT, embedding_model TEXT, chunk_size INTEGER, top_k INTEGER,
        min_score REAL, delete_time TEXT, expire_time TEXT, purge_status TEXT,
        purged_at TEXT, create_time TEXT, update_time TEXT);
      CREATE TABLE api_keys (api_key_id TEXT, key_hash TEXT, namespace TEXT,
        world_id TEXT, scopes TEXT, revoked_at TEXT);
    `);

    try {
      await expect(
        ensureControlPlaneSchema(asD1Database(sqlite)),
      ).rejects.toThrow("Conflicting identifier columns in worlds");
    } finally {
      sqlite.close();
    }
  });
});
