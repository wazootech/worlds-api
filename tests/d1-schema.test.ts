import { describe, expect, it, vi } from "vitest";
import app from "../src/app";
import type { Env } from "../src/env";
import {
  assertControlPlaneSchema,
  CONTROL_PLANE_DDL,
  ensureControlPlaneSchema,
} from "../src/lib/d1-schema";
import { getDb } from "../src/lib/db";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

vi.mock("../src/lib/db", () => ({
  getDb: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  newId: vi.fn(() => "test-id"),
  now: vi.fn(() => "2026-01-01T00:00:00.000Z"),
}));

const getDbMock = vi.mocked(getDb);
const worldColumns = [
  "world_id",
  "namespace",
  "display_name",
  "state",
  "embedding_model",
  "chunk_size",
  "top_k",
  "min_score",
  "delete_time",
  "expire_time",
  "purge_status",
  "purged_at",
  "create_time",
  "update_time",
];
const apiKeyColumns = [
  "api_key_id",
  "key_hash",
  "name",
  "namespace",
  "world_id",
  "scopes",
  "create_time",
  "revoked_at",
];

function database(
  options: {
    failFirstDdl?: boolean;
    missingWorldId?: boolean;
    wrongWorldPrimaryKey?: boolean;
  } = {},
) {
  let ddlRuns = 0;
  const db = {
    exec: vi.fn(async () => {}),
    prepare: vi.fn((sql: string) => ({
      run: vi.fn(async () => {
        if (sql.startsWith("CREATE")) {
          ddlRuns++;
          if (options.failFirstDdl && ddlRuns === 1) {
            throw new Error("D1 permission denied");
          }
        }
        return { success: true, meta: { changes: 0 } };
      }),
      first: vi.fn(async () => ({ value: 1 })),
      all: vi.fn(async () => {
        const table = sql.includes("table_info('worlds')")
          ? "worlds"
          : "api_keys";
        const names =
          table === "worlds"
            ? options.missingWorldId
              ? worldColumns.map((name) =>
                  name === "world_id" ? "old_identifier" : name,
                )
              : worldColumns
            : apiKeyColumns;
        const expectedPrimaryKey =
          table === "worlds" ? "world_id" : "api_key_id";
        const primaryKey =
          table === "worlds" && options.wrongWorldPrimaryKey
            ? "id"
            : expectedPrimaryKey;
        const results = names.map((name) => ({
          name,
          pk: name === primaryKey ? 1 : 0,
        }));
        if (table === "worlds" && options.wrongWorldPrimaryKey) {
          results.push({ name: "id", pk: 1 });
        }
        return {
          results,
          success: true,
          meta: { changes: 0 },
        };
      }),
    })),
  };
  return {
    db,
    get ddlRuns() {
      return ddlRuns;
    },
  };
}

describe("control-plane schema readiness", () => {
  it("logs and rethrows a DDL failure", async () => {
    const mock = database({ failFirstDdl: true });
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(ensureControlPlaneSchema(mock.db as never)).rejects.toThrow(
      "D1 permission denied",
    );
    expect(logger).toHaveBeenCalledWith(
      "Control-plane schema DDL failed",
      expect.objectContaining({ ddl: CONTROL_PLANE_DDL[0] }),
    );
    expect(mock.ddlRuns).toBe(1);
    logger.mockRestore();
  });

  it("rejects an old schema without the canonical world_id column", async () => {
    const mock = database({ missingWorldId: true });

    await expect(assertControlPlaneSchema(mock.db as never)).rejects.toThrow(
      "Control-plane schema mismatch in worlds: missing world_id",
    );
  });

  it("rejects a world table with a noncanonical primary key", async () => {
    const mock = database({ wrongWorldPrimaryKey: true });

    await expect(assertControlPlaneSchema(mock.db as never)).rejects.toThrow(
      "Control-plane schema mismatch in worlds: primary key must be world_id, found id",
    );
  });

  it("retries DDL after a failed readiness request instead of latching", async () => {
    const mock = database({ failFirstDdl: true });
    getDbMock.mockReturnValue(mock.db as never);
    const env = { DB: mock.db } as unknown as Env;
    const context = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as never;
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});

    const first = await app.request("/ready", {}, env, context);
    const second = await app.request("/ready", {}, env, context);

    expect(first.status).toBe(503);
    expect(second.status).toBe(200);
    expect((await second.json()).status).toBe("ready");
    expect(mock.ddlRuns).toBe(CONTROL_PLANE_DDL.length + 1);
    logger.mockRestore();
  });

  it("keeps /health live while /ready rejects an old schema", async () => {
    const mock = database({ missingWorldId: true });
    getDbMock.mockReturnValue(mock.db as never);
    const env = { DB: mock.db } as unknown as Env;
    const context = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as never;

    const live = await app.request("/health", {}, env, context);
    const ready = await app.request("/ready", {}, env, context);

    expect(live.status).toBe(200);
    expect((await ready.json()).status).toBe("not_ready");
    expect(ready.status).toBe(503);
  });

  it("creates runtime control-plane tables with canonical primary keys", () => {
    const db = new DatabaseSync(":memory:");
    try {
      for (const ddl of CONTROL_PLANE_DDL) db.exec(ddl);
      for (const [table, expectedKey] of Object.entries({
        worlds: "world_id",
        api_keys: "api_key_id",
      })) {
        const primaryKeys = (
          db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
            name: string;
            pk: number;
          }>
        ).filter((column) => column.pk > 0);
        expect(primaryKeys.map((column) => column.name)).toEqual([expectedKey]);
      }
    } finally {
      db.close();
    }
  });
});

describe("standalone schema identity contract", () => {
  it("uses entity-specific primary keys in every persisted entity table", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(readFileSync("schema.sql", "utf8"));
      const expected = {
        worlds_metadata: "world_id",
        api_keys: "api_key_id",
        quads: "quad_id",
        chunks: "chunk_id",
      } as const;
      for (const [table, key] of Object.entries(expected)) {
        const primaryKeys = (
          db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
            name: string;
            pk: number;
          }>
        ).filter((column) => column.pk > 0);
        expect(primaryKeys.map((column) => column.name)).toEqual([key]);
      }
    } finally {
      db.close();
    }
  });
});
