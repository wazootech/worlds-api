import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertControlPlaneSchema,
  CONTROL_PLANE_DDL,
  ensureControlPlaneSchema,
} from "../src/lib/d1-schema";

const canonicalSchema = {
  worlds: [
    { name: "world_id", pk: 1 },
    { name: "namespace", pk: 0 },
    { name: "display_name", pk: 0 },
    { name: "state", pk: 0 },
    { name: "embedding_model", pk: 0 },
    { name: "chunk_size", pk: 0 },
    { name: "top_k", pk: 0 },
    { name: "min_score", pk: 0 },
    { name: "delete_time", pk: 0 },
    { name: "expire_time", pk: 0 },
    { name: "purge_status", pk: 0 },
    { name: "purged_at", pk: 0 },
    { name: "create_time", pk: 0 },
    { name: "update_time", pk: 0 },
  ],
  api_keys: [
    { name: "uid", pk: 1 },
    { name: "key_hash", pk: 0 },
    { name: "name", pk: 0 },
    { name: "namespace", pk: 0 },
    { name: "world_id", pk: 0 },
    { name: "scopes", pk: 0 },
    { name: "create_time", pk: 0 },
    { name: "revoked_at", pk: 0 },
  ],
};

function makeDb(
  schemas: Record<string, Array<{ name: string; pk: number }>> = {},
  run: (sql: string) => Promise<unknown> = async () => ({ success: true }),
) {
  return {
    prepare(sql: string) {
      return {
        all: async () => {
          const table = sql.match(/PRAGMA table_info\('([^']+)'\)/)?.[1];
          return { results: table ? (schemas[table] ?? []) : [] };
        },
        run: () => run(sql),
      };
    },
  } as unknown as D1Database;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Worlds API control-plane schema", () => {
  it("runs every DDL statement", async () => {
    const run = vi.fn(async () => ({ success: true }));
    await ensureControlPlaneSchema(makeDb({}, run));
    expect(run).toHaveBeenCalledTimes(CONTROL_PLANE_DDL.length);
    expect(run.mock.calls.map(([sql]) => sql)).toEqual([...CONTROL_PLANE_DDL]);
  });

  it("logs and propagates DDL failures", async () => {
    const error = new Error("D1 rejected statement");
    const run = vi.fn(async () => {
      throw error;
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(ensureControlPlaneSchema(makeDb({}, run))).rejects.toBe(error);
    expect(run).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("Worlds API control-plane DDL failed", {
      ddl: CONTROL_PLANE_DDL[0],
      error,
    });
  });

  it("accepts the canonical world_id primary key and required columns", async () => {
    await expect(
      assertControlPlaneSchema(makeDb(canonicalSchema)),
    ).resolves.toBeUndefined();
  });

  it("rejects legacy world identity columns alongside world_id", async () => {
    const legacyIdentity = {
      ...canonicalSchema,
      worlds: [
        ...canonicalSchema.worlds,
        { name: "uid", pk: 0 },
        { name: "worlds_api_uid", pk: 0 },
        { name: "slug", pk: 0 },
      ],
    };

    await expect(
      assertControlPlaneSchema(makeDb(legacyIdentity)),
    ).rejects.toThrow(/legacy columns present: uid, worlds_api_uid, slug/);
  });

  it("requires the API-key primary key used by this schema", async () => {
    const missingUid = {
      ...canonicalSchema,
      api_keys: canonicalSchema.api_keys.filter(
        (column) => column.name !== "uid",
      ),
    };

    await expect(assertControlPlaneSchema(makeDb(missingUid))).rejects.toThrow(
      /missing columns: uid; expected primary key uid, found none/,
    );
  });

  it("rejects a legacy world_uid reference on API keys", async () => {
    const legacyReference = {
      ...canonicalSchema,
      api_keys: [...canonicalSchema.api_keys, { name: "world_uid", pk: 0 }],
    };

    await expect(
      assertControlPlaneSchema(makeDb(legacyReference)),
    ).rejects.toThrow(/legacy columns present: world_uid/);
  });

  it("rejects the old worlds.uid schema", async () => {
    const legacySchema = {
      ...canonicalSchema,
      worlds: canonicalSchema.worlds.map((column) =>
        column.name === "world_id" ? { name: "uid", pk: 1 } : column,
      ),
    };

    await expect(
      assertControlPlaneSchema(makeDb(legacySchema)),
    ).rejects.toThrow(
      /Control-plane schema mismatch for worlds: missing columns: world_id; legacy columns present: uid; expected primary key world_id, found uid/,
    );
  });
});
