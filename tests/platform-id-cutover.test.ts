import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migratePlatformIds } from "../migrations/platform-id-cutover.mjs";

const fixture = readFileSync(
  new URL("./fixtures/platform-id-cutover-before.sql", import.meta.url),
  "utf8",
);

const metadataOnlyFixture = readFileSync(
  new URL("./fixtures/platform-id-metadata-only-before.sql", import.meta.url),
  "utf8",
);

function rows(db: DatabaseSync, sql: string) {
  return db.prepare(sql).all() as Record<string, unknown>[];
}

function columnNames(db: DatabaseSync, table: string): string[] {
  return rows(db, `PRAGMA table_info("${table}")`).map((row) =>
    String(row.name),
  );
}

function renameField(
  records: Record<string, unknown>[],
  from: string,
  to: string,
) {
  return records.map(({ [from]: value, ...record }) => ({
    ...record,
    [to]: value,
  }));
}

describe("platform identity cutover migration", () => {
  it("preserves worlds, keys, metadata, and child rows with valid foreign keys", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(fixture);
      const worldsBefore = rows(db, "SELECT * FROM worlds ORDER BY uid");
      const metadataBefore = rows(
        db,
        "SELECT * FROM worlds_metadata ORDER BY uid",
      );
      const keysBefore = rows(db, "SELECT * FROM api_keys ORDER BY uid");
      const quadsBefore = rows(db, "SELECT * FROM quads ORDER BY id");
      const chunksBefore = rows(db, "SELECT * FROM chunks ORDER BY id");

      const result = await migratePlatformIds(db as never);

      expect(result.renames).toEqual([
        { table: "worlds", from: "uid", to: "world_id" },
        { table: "worlds_metadata", from: "uid", to: "world_id" },
        { table: "api_keys", from: "uid", to: "api_key_id" },
        { table: "quads", from: "world_uid", to: "world_id" },
        { table: "chunks", from: "world_uid", to: "world_id" },
      ]);
      expect(rows(db, "SELECT * FROM worlds ORDER BY world_id")).toEqual(
        renameField(worldsBefore, "uid", "world_id"),
      );
      expect(
        rows(db, "SELECT * FROM worlds_metadata ORDER BY world_id"),
      ).toEqual(renameField(metadataBefore, "uid", "world_id"));
      expect(rows(db, "SELECT * FROM api_keys ORDER BY api_key_id")).toEqual(
        renameField(keysBefore, "uid", "api_key_id"),
      );
      expect(rows(db, "SELECT * FROM quads ORDER BY id")).toEqual(
        renameField(quadsBefore, "world_uid", "world_id"),
      );
      expect(rows(db, "SELECT * FROM chunks ORDER BY id")).toEqual(
        renameField(chunksBefore, "world_uid", "world_id"),
      );

      for (const [table, required, legacy] of [
        ["worlds", "world_id", "uid"],
        ["worlds_metadata", "world_id", "uid"],
        ["api_keys", "api_key_id", "uid"],
        ["quads", "world_id", "world_uid"],
        ["chunks", "world_id", "world_uid"],
      ]) {
        expect(columnNames(db, table)).toContain(required);
        expect(columnNames(db, table)).not.toContain(legacy);
      }
      expect(rows(db, "PRAGMA foreign_key_check")).toEqual([]);
      expect(
        rows(
          db,
          `SELECT child.world_id FROM worlds_metadata child LEFT JOIN worlds parent ON child.world_id = parent.world_id WHERE parent.world_id IS NULL`,
        ),
      ).toEqual([]);
      expect(
        rows(
          db,
          `SELECT child.api_key_id FROM api_keys child LEFT JOIN worlds parent ON child.world_id = parent.world_id WHERE child.world_id IS NOT NULL AND parent.world_id IS NULL`,
        ),
      ).toEqual([]);
      expect(
        rows(
          db,
          `SELECT child.id FROM quads child LEFT JOIN worlds parent ON child.world_id = parent.world_id WHERE parent.world_id IS NULL`,
        ),
      ).toEqual([]);
      expect(
        rows(
          db,
          `SELECT child.id FROM chunks child LEFT JOIN worlds parent ON child.world_id = parent.world_id WHERE parent.world_id IS NULL`,
        ),
      ).toEqual([]);
      expect(
        rows(db, "SELECT migration_id FROM worlds_api_migrations"),
      ).toEqual([{ migration_id: "platform-id-cutover-v1" }]);

      const rerun = await migratePlatformIds(db as never);
      expect(rerun.renames).toEqual([]);
      expect(rerun.foreignKeyViolations).toBe(0);
    } finally {
      db.close();
    }
  });

  it("renames the legacy worlds_metadata table while preserving dependent rows", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(metadataOnlyFixture);
      const worldsBefore = rows(
        db,
        "SELECT * FROM worlds_metadata ORDER BY uid",
      );
      const keysBefore = rows(db, "SELECT * FROM api_keys ORDER BY uid");
      const quadsBefore = rows(db, "SELECT * FROM quads ORDER BY id");
      const chunksBefore = rows(db, "SELECT * FROM chunks ORDER BY id");

      const result = await migratePlatformIds(db as never);

      expect(result.tableRenames).toEqual([
        { from: "worlds_metadata", to: "worlds" },
      ]);
      expect(result.renames).toEqual([
        { table: "worlds_metadata", from: "uid", to: "world_id" },
        { table: "api_keys", from: "uid", to: "api_key_id" },
      ]);
      expect(rows(db, "SELECT * FROM worlds ORDER BY world_id")).toEqual(
        renameField(worldsBefore, "uid", "world_id"),
      );
      expect(rows(db, "SELECT * FROM api_keys ORDER BY api_key_id")).toEqual(
        renameField(keysBefore, "uid", "api_key_id"),
      );
      expect(rows(db, "SELECT * FROM quads ORDER BY id")).toEqual(quadsBefore);
      expect(rows(db, "SELECT * FROM chunks ORDER BY id")).toEqual(
        chunksBefore,
      );
      expect(rows(db, "PRAGMA foreign_key_check")).toEqual([]);
      expect(
        rows(
          db,
          "SELECT name FROM sqlite_master WHERE name = 'worlds_metadata'",
        ),
      ).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("rejects a dry run without changing the legacy schema", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(fixture);
      const result = await migratePlatformIds(db as never, { dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.renames).toHaveLength(5);
      expect(columnNames(db, "worlds")).toContain("uid");
      expect(columnNames(db, "worlds")).not.toContain("world_id");
      expect(rows(db, "PRAGMA foreign_key_check")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("refuses to change schema when foreign keys already contain orphans", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(fixture);
      db.exec(
        "PRAGMA foreign_keys = OFF; INSERT INTO quads (id, world_uid, subject, payload) VALUES ('orphan', 'w_missing', 'urn:orphan', 'bad');",
      );

      await expect(migratePlatformIds(db as never)).rejects.toThrow(
        /foreign-key violation/i,
      );
      expect(columnNames(db, "worlds")).toContain("uid");
      expect(columnNames(db, "worlds")).not.toContain("world_id");
      expect(columnNames(db, "api_keys")).toContain("uid");
    } finally {
      db.close();
    }
  });
});
