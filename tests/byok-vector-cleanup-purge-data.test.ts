import { describe, expect, it, vi } from "vitest";
import { deleteWorldData } from "../src/lib/purge-data";
import { runPurgeSweep } from "../src/lib/purge";
import {
  addWorld,
  db,
  importTurtle,
  KEPT,
  makeEnv,
  seedReadyWorld,
  useCleanupHarness,
  WORLD_A,
  WORLD_B,
} from "./helpers/byok-cleanup-harness";

// The real engine creates the data-plane tables on first import.
vi.mock(
  "@worlds/cloudflare",
  async () => await import("../node_modules/@worlds/cloudflare/src/mod.js"),
);
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

useCleanupHarness();

const count = (sql: string, ...args: string[]) =>
  Number((db.raw.prepare(sql).get(...args) as { n: number }).n);
const rows = (table: string, worldId: string) =>
  count(`SELECT COUNT(*) AS n FROM ${table} WHERE world_id = ?`, worldId);
const ftsHits = () =>
  count("SELECT COUNT(*) AS n FROM chunks_fts WHERE chunks_fts MATCH 'quokka'");
const status = (worldId: string) =>
  (
    db.raw
      .prepare("SELECT purge_status FROM worlds WHERE world_id = ?")
      .get(worldId) as { purge_status: string }
  ).purge_status;

async function expire(worldId: string, at = "2000-01-01T00:00:00.000Z") {
  await db
    .prepare(
      "UPDATE worlds SET state = 'deleted', purge_status = 'pending', expire_time = ? WHERE world_id = ?",
    )
    .bind(at, worldId)
    .run();
}

async function seedTwoWorlds() {
  db.raw.exec("DELETE FROM world_inference");
  const env = makeEnv();
  await addWorld(WORLD_B, "ns-1");
  await seedReadyWorld(env, WORLD_A);
  await importTurtle(env, WORLD_B, KEPT);
  const now = new Date().toISOString();
  for (const id of [WORLD_A, WORLD_B]) {
    await db
      .prepare(
        "INSERT INTO world_inference (world_id, enabled, update_time) VALUES (?, 1, ?)",
      )
      .bind(id, now)
      .run();
  }
  return env;
}

describe("purge sweep deletes the purged world's data", () => {
  it("removes quads, chunks, FTS, inference and embedding rows, only for that world", async () => {
    const env = await seedTwoWorlds();
    expect(rows("quads", WORLD_A)).toBeGreaterThan(0);
    expect(rows("chunks", WORLD_A)).toBeGreaterThan(0);
    expect(ftsHits()).toBe(1);
    await expire(WORLD_A);

    expect(await runPurgeSweep(env)).toEqual({ purged: 1, failed: 0 });

    for (const table of [
      "quads",
      "chunks",
      "world_inference",
      "world_embedding_state",
    ]) {
      expect(rows(table, WORLD_A), table).toBe(0);
    }
    expect(ftsHits()).toBe(0);
    expect(status(WORLD_A)).toBe("purged");
    expect(rows("quads", WORLD_B)).toBe(1);
    expect(rows("chunks", WORLD_B)).toBe(1);
    expect(rows("world_inference", WORLD_B)).toBe(1);
    expect(
      count(
        "SELECT COUNT(*) AS n FROM chunks_fts WHERE chunks_fts MATCH 'penguins'",
      ),
    ).toBe(1);
    expect(await runPurgeSweep(env)).toEqual({ purged: 0, failed: 0 });
  });

  it("keeps data until the grace period has elapsed", async () => {
    const env = await seedTwoWorlds();
    await expire(WORLD_A, "2999-01-01T00:00:00.000Z");
    expect(await runPurgeSweep(env)).toEqual({ purged: 0, failed: 0 });
    expect(rows("quads", WORLD_A)).toBeGreaterThan(0);
    expect(status(WORLD_A)).toBe("pending");
  });

  it("leaves the world pending when a delete fails, then finishes on retry", async () => {
    const env = await seedTwoWorlds();
    await expire(WORLD_A);
    const real = env.DB;
    let fail = true;
    env.DB = new Proxy(real, {
      get: (target, key) =>
        key === "prepare"
          ? (sql: string) => {
              if (fail && sql.startsWith("DELETE FROM quads")) {
                throw new Error("d1 unavailable");
              }
              return target.prepare(sql);
            }
          : (target as never)[key],
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await runPurgeSweep(env)).toEqual({ purged: 0, failed: 1 });
    expect(status(WORLD_A)).toBe("pending");
    fail = false;
    expect(await runPurgeSweep(env)).toEqual({ purged: 1, failed: 0 });
    expect(rows("quads", WORLD_A)).toBe(0);
  });

  it("is bounded per run and resumes where it stopped", async () => {
    const env = await seedTwoWorlds();
    for (let i = 0; i < 1200; i++) {
      db.raw
        .prepare(
          "INSERT INTO quads (quad_id, s, s_type, p, o, o_type, g, g_type, derived, world_id) VALUES (?, 's', 'n', 'p', 'o', 'n', 'g', 'n', 0, ?)",
        )
        .run(`bulk-${i}`, WORLD_A);
    }
    const budget = { batches: 2 };
    expect(await deleteWorldData(env.DB, WORLD_A, budget)).toBe(false);
    expect(budget.batches).toBe(0);
    expect(rows("quads", WORLD_A)).toBeGreaterThan(0);

    expect(await deleteWorldData(env.DB, WORLD_A, { batches: 10 })).toBe(true);
    expect(rows("quads", WORLD_A)).toBe(0);
    expect(await deleteWorldData(env.DB, WORLD_A, { batches: 10 })).toBe(true);
    expect(rows("quads", WORLD_B)).toBe(1);
  });
});
