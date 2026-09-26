import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { migratePlatformIds } from "../scripts/migrations/platform-id-cutover.mjs";

const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/legacy-platform-id-schema.sql",
);

function count(db: DatabaseSync, table: string): number {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count);
}

describe("platform ID cutover migration", () => {
  it("preserves worlds, keys and dependent data with valid foreign keys", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync(fixturePath, "utf8"));

    const beforeWorlds = db
      .prepare("SELECT uid, namespace, display_name, state, create_time, update_time FROM worlds ORDER BY uid")
      .all();
    const beforeMetadata = db
      .prepare("SELECT uid, namespace, display_name, create_time FROM worlds_metadata ORDER BY uid")
      .all();
    const beforeKeys = db
      .prepare("SELECT uid, key_hash, name, namespace, world_id, scopes, create_time, revoked_at FROM api_keys ORDER BY uid")
      .all();
    const beforeQuads = db
      .prepare("SELECT id, world_uid, subject FROM quads ORDER BY id")
      .all();
    const beforeChunks = db
      .prepare("SELECT id, world_uid, quad_id, text FROM chunks ORDER BY id")
      .all();
    const beforeCounts = new Map(
      ["worlds", "worlds_metadata", "api_keys", "quads", "chunks"].map((table) => [
        table,
        count(db, table),
      ]),
    );

    const result = await migratePlatformIds(db);

    expect(result.migrated).toBe(true);
    expect(result.verifiedTables).toEqual([
      "worlds",
      "api_keys",
      "worlds_metadata",
      "quads",
      "chunks",
    ]);
    expect(count(db, "worlds")).toBe(beforeCounts.get("worlds"));
    expect(count(db, "worlds_metadata")).toBe(beforeCounts.get("worlds_metadata"));
    expect(count(db, "api_keys")).toBe(beforeCounts.get("api_keys"));
    expect(count(db, "quads")).toBe(beforeCounts.get("quads"));
    expect(count(db, "chunks")).toBe(beforeCounts.get("chunks"));

    expect(
      db.prepare("SELECT world_id, namespace, display_name, state, create_time, update_time FROM worlds ORDER BY world_id").all(),
    ).toEqual(
      beforeWorlds.map(({ uid, ...row }) => ({ world_id: uid, ...row })),
    );
    expect(
      db.prepare("SELECT world_id, namespace, display_name, create_time FROM worlds_metadata ORDER BY world_id").all(),
    ).toEqual(
      beforeMetadata.map(({ uid, ...row }) => ({ world_id: uid, ...row })),
    );
    expect(
      db.prepare("SELECT api_key_id, key_hash, name, namespace, world_id, scopes, create_time, revoked_at FROM api_keys ORDER BY api_key_id").all(),
    ).toEqual(
      beforeKeys.map(({ uid, ...row }) => ({ api_key_id: uid, ...row })),
    );
    expect(
      db.prepare("SELECT id, world_id, subject FROM quads ORDER BY id").all(),
    ).toEqual(beforeQuads.map(({ world_uid, ...row }) => ({ world_id: world_uid, ...row })));
    expect(
      db.prepare("SELECT id, world_id, quad_id, text FROM chunks ORDER BY id").all(),
    ).toEqual(beforeChunks.map(({ world_uid, ...row }) => ({ world_id: world_uid, ...row })));

    expect(db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM api_keys child LEFT JOIN worlds parent ON child.world_id = parent.world_id WHERE child.world_id IS NOT NULL AND parent.world_id IS NULL").get()?.count,
    ).toBe(0);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM quads child LEFT JOIN worlds parent ON child.world_id = parent.world_id WHERE parent.world_id IS NULL").get()?.count,
    ).toBe(0);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM chunks child LEFT JOIN worlds parent ON child.world_id = parent.world_id WHERE parent.world_id IS NULL").get()?.count,
    ).toBe(0);
    expect(
      db.prepare("SELECT migration_id FROM worlds_api_migrations").get()?.migration_id,
    ).toBe("platform-id-cutover-v1");

    const rerun = await migratePlatformIds(db);
    expect(rerun.migrated).toBe(false);
    db.close();
  });
});
