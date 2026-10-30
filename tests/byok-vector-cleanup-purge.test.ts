import { describe, expect, it, vi } from "vitest";
import {
  getCredential,
  getWorldState,
  setWorldState,
} from "../src/lib/embeddings/store";
import { cleanupWorldVectors } from "../src/lib/embeddings/vectors";
import { runPurgeSweep } from "../src/lib/purge";
import {
  addWorld,
  chunkRows,
  db,
  http,
  importTurtle,
  KEPT,
  makeEnv,
  MODEL,
  seedReadyWorld,
  useCleanupHarness,
  vectorize,
  WORLD_A,
  WORLD_B,
} from "./helpers/byok-cleanup-harness";

// vitest.config.ts aliases "@worlds/cloudflare" to a type stub (the package's
// source tree is not loadable through its public specifier here). This file
// wants the real engine, so it loads the package entry by path.
vi.mock(
  "@worlds/cloudflare",
  async () => await import("../node_modules/@worlds/cloudflare/src/mod.js"),
);
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

useCleanupHarness();

describe("namespace delete and purge remove vectors", () => {
  it("namespace delete deletes every world's vectors, reports it, and marks worlds stale", async () => {
    const env = makeEnv();
    await addWorld(WORLD_B, "ns-1");
    await seedReadyWorld(env, WORLD_A);
    await setWorldState(env, WORLD_B, "ready", MODEL);
    await importTurtle(env, WORLD_B, KEPT);
    expect(vectorize.store.size).toBe(3);

    const res = await http(env, "admin-key", "/admin/namespaces/ns-1/delete", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.vectorCleanup).toMatchObject({
      worlds: 2,
      attempted: 3,
      deleted: 3,
      failed: 0,
      incomplete: false,
    });
    expect(vectorize.store.size).toBe(0);
    expect((await getWorldState(env, WORLD_A))?.state).toBe("stale");
    expect((await getWorldState(env, WORLD_B))?.state).toBe("stale");
    expect((await getCredential(env, "ns-1", "openai"))?.status).toBe(
      "revoked",
    );
    // D1 no longer claims vectors that are gone.
    expect(chunkRows(WORLD_A).every((r) => r.has_vec === 0)).toBe(true);
  });

  it("namespace delete reports a Vectorize failure and is safe to re-run", async () => {
    const env = makeEnv();
    await seedReadyWorld(env);
    vectorize.failDelete = true;

    const first = await http(
      env,
      "admin-key",
      "/admin/namespaces/ns-1/delete",
      {
        method: "POST",
      },
    );
    const report = ((await first.json()) as any).vectorCleanup;
    expect(report).toMatchObject({ failed: 2, incomplete: true });
    expect(vectorize.store.size).toBe(2);

    vectorize.failDelete = false;
    const again = await http(
      env,
      "admin-key",
      "/admin/namespaces/ns-1/delete",
      {
        method: "POST",
      },
    );
    expect(((await again.json()) as any).vectorCleanup).toMatchObject({
      deleted: 2,
      failed: 0,
      incomplete: false,
    });
    expect(vectorize.store.size).toBe(0);
  });

  it("purge deletes a world's vectors before marking it purged, and retries on failure", async () => {
    const env = makeEnv();
    await seedReadyWorld(env);
    await db
      .prepare(
        "UPDATE worlds SET state = 'deleted', purge_status = 'pending', expire_time = '2000-01-01T00:00:00.000Z' WHERE world_id = ?",
      )
      .bind(WORLD_A)
      .run();

    vectorize.failDelete = true;
    expect(await runPurgeSweep(env)).toEqual({ purged: 0, failed: 1 });
    expect(
      (
        db.raw
          .prepare("SELECT purge_status FROM worlds WHERE world_id = ?")
          .get(WORLD_A) as any
      ).purge_status,
    ).toBe("pending");
    expect(vectorize.store.size).toBe(2);

    vectorize.failDelete = false;
    expect(await runPurgeSweep(env)).toEqual({ purged: 1, failed: 0 });
    expect(vectorize.store.size).toBe(0);
    expect(
      (
        db.raw
          .prepare("SELECT purge_status FROM worlds WHERE world_id = ?")
          .get(WORLD_A) as any
      ).purge_status,
    ).toBe("purged");
  });

  it("cleanupWorldVectors('all') is resumable across requests", async () => {
    const env = makeEnv();
    await seedReadyWorld(env);
    // Sanity: a single pass clears everything and is idempotent.
    const first = await cleanupWorldVectors(env, WORLD_A, "all");
    expect(first).toMatchObject({ attempted: 2, deleted: 2, failed: 0 });
    const second = await cleanupWorldVectors(env, WORLD_A, "all");
    expect(second).toMatchObject({ attempted: 0, deleted: 0, failed: 0 });
  });
});
