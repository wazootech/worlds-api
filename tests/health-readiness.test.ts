import { describe, expect, it, vi } from "vitest";

const schema = {
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
  schemas: Record<string, Array<{ name: string; pk: number }>>,
  run: (sql: string) => Promise<unknown> = async () => ({ success: true }),
) {
  return {
    exec: vi.fn(async () => {}),
    prepare(sql: string) {
      return {
        all: async () => {
          const table = sql.match(/PRAGMA table_info\('([^']+)'\)/)?.[1];
          return { results: table ? (schemas[table] ?? []) : [] };
        },
        first: async () => ({ value: 1 }),
        run: () => run(sql),
      };
    },
  } as unknown as D1Database;
}

async function requestReady(db: D1Database) {
  vi.resetModules();
  const app = (await import("../src/app")).default;
  const executionCtx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  return app.request("/ready", {}, { DB: db } as never, executionCtx);
}

async function requestHealth(db: D1Database) {
  vi.resetModules();
  const app = (await import("../src/app")).default;
  const executionCtx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  return app.request("/health", {}, { DB: db } as never, executionCtx);
}

describe("GET /ready", () => {
  it("keeps liveness separate from schema readiness", async () => {
    const legacy = {
      ...schema,
      worlds: schema.worlds.map((column) =>
        column.name === "world_id" ? { name: "uid", pk: 1 } : column,
      ),
    };
    const res = await requestHealth(makeDb(legacy));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok" });
  });

  it("returns ready only when the control-plane schema matches", async () => {
    const res = await requestReady(makeDb(schema));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ready" });
  });

  it("rejects the legacy worlds.uid schema", async () => {
    const legacy = {
      ...schema,
      worlds: schema.worlds.map((column) =>
        column.name === "world_id" ? { name: "uid", pk: 1 } : column,
      ),
    };
    const res = await requestReady(makeDb(legacy));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      status: "not_ready",
      error: expect.stringMatching(/missing columns: world_id/),
    });
  });

  it("reports DDL failures as not ready", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = makeDb(schema, async () => {
      throw new Error("schema DDL rejected");
    });
    const res = await requestReady(db);
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      status: "not_ready",
      error: "schema DDL rejected",
    });
    expect(log).toHaveBeenCalledOnce();
  });
});
