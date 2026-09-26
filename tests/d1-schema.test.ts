import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ensureControlPlaneSchema } from "../src/lib/d1-schema";
import { readFileSync } from "node:fs";

const legacyFixture = readFileSync(
  new URL("./fixtures/platform-id-cutover-before.sql", import.meta.url),
  "utf8",
);

function asD1Database(sqlite: DatabaseSync) {
  return {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      return {
        all: async () => ({ results: statement.all() }),
        run: async () => ({
          meta: { changes: Number(statement.run().changes) },
        }),
      };
    },
  } as never;
}

function columns(sqlite: DatabaseSync, table: string): string[] {
  return sqlite
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => String((column as { name: string }).name));
}

describe("control-plane schema identity contract", () => {
  it("creates canonical identifier columns on a fresh database", async () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      await ensureControlPlaneSchema(asD1Database(sqlite));

      expect(columns(sqlite, "worlds")).toContain("world_id");
      expect(columns(sqlite, "api_keys")).toContain("api_key_id");
      expect(columns(sqlite, "api_keys")).toContain("world_id");
    } finally {
      sqlite.close();
    }
  });

  it("fails closed on the legacy schema without adding compatibility columns", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(legacyFixture);

    try {
      await expect(
        ensureControlPlaneSchema(asD1Database(sqlite)),
      ).rejects.toThrow(/worlds: missing world_id/);
      expect(columns(sqlite, "worlds")).not.toContain("world_id");
      expect(columns(sqlite, "api_keys")).not.toContain("api_key_id");
    } finally {
      sqlite.close();
    }
  });
});
