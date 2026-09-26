import { describe, expect, it } from "vitest";
import { ensureControlPlaneSchema } from "../src/lib/d1-schema";

type TableState = {
  columns: string[];
  rows: Record<string, unknown>[];
};

function mockDatabase(tables: Record<string, TableState>) {
  const statements: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        all: async <T>() => {
          const table = sql.match(/^PRAGMA table_info\((\w+)\)$/)?.[1];
          if (!table) throw new Error(`Unexpected query: ${sql}`);
          return {
            results: (tables[table]?.columns ?? []).map((name) => ({
              name,
            })) as T[],
          };
        },
        run: async () => {
          statements.push(sql);
          const rename = sql.match(
            /^ALTER TABLE (\w+) RENAME COLUMN (\w+) TO (\w+)$/,
          );
          if (rename) {
            const [, tableName, previous, current] = rename;
            const table = tables[tableName];
            if (!table.columns.includes(previous)) {
              throw new Error(`Missing column ${previous}`);
            }
            table.columns = table.columns.map((column) =>
              column === previous ? current : column,
            );
            table.rows = table.rows.map((row) => {
              const { [previous]: value, ...rest } = row;
              return { ...rest, [current]: value };
            });
          }
          return { meta: { changes: 1 } };
        },
      };
    },
  };
  return { db: db as never, statements };
}

describe("control-plane identifier migration", () => {
  it("renames existing identifiers while preserving world, key, and data relationships", async () => {
    const tables: Record<string, TableState> = {
      worlds: {
        columns: ["uid", "namespace", "display_name", "state"],
        rows: [
          {
            uid: "w_existing",
            namespace: "user_existing",
            display_name: "Existing world",
            state: "active",
          },
        ],
      },
      api_keys: {
        columns: ["uid", "key_hash", "namespace", "world_id", "scopes"],
        rows: [
          {
            uid: "key_existing",
            key_hash: "hash_existing",
            namespace: "user_existing",
            world_id: "w_existing",
            scopes: '["data:read"]',
          },
        ],
      },
      quads: {
        columns: ["id", "namespace", "world_id", "subject"],
        rows: [
          {
            id: "quad_existing",
            namespace: "user_existing",
            world_id: "w_existing",
            subject: "https://example.test/item",
          },
        ],
      },
      chunks: {
        columns: ["id", "namespace", "world_id", "text"],
        rows: [
          {
            id: "chunk_existing",
            namespace: "user_existing",
            world_id: "w_existing",
            text: "Existing data",
          },
        ],
      },
    };
    const { db, statements } = mockDatabase(tables);

    await ensureControlPlaneSchema(db);

    expect(tables.worlds.columns).toContain("world_id");
    expect(tables.worlds.columns).not.toContain("uid");
    expect(tables.worlds.rows[0]).toEqual({
      world_id: "w_existing",
      namespace: "user_existing",
      display_name: "Existing world",
      state: "active",
    });
    expect(tables.api_keys.columns).toContain("api_key_id");
    expect(tables.api_keys.columns).not.toContain("uid");
    expect(tables.api_keys.rows[0]).toEqual({
      api_key_id: "key_existing",
      key_hash: "hash_existing",
      namespace: "user_existing",
      world_id: "w_existing",
      scopes: '["data:read"]',
    });
    expect(tables.quads.rows[0].world_id).toBe("w_existing");
    expect(tables.chunks.rows[0].world_id).toBe("w_existing");
    expect(
      statements.filter((statement) => statement.startsWith("ALTER TABLE")),
    ).toHaveLength(2);

    await ensureControlPlaneSchema(db);

    expect(
      statements.filter((statement) => statement.startsWith("ALTER TABLE")),
    ).toHaveLength(2);
  });

  it("fails closed when both old and canonical columns exist", async () => {
    const { db } = mockDatabase({
      worlds: {
        columns: ["uid", "world_id", "namespace"],
        rows: [],
      },
      api_keys: {
        columns: ["api_key_id", "namespace", "world_id"],
        rows: [],
      },
    });

    await expect(ensureControlPlaneSchema(db)).rejects.toThrow(
      "Conflicting identifier columns in worlds",
    );
  });
});
