import { describe, expect, it, vi } from "vitest";
import { getWorldState, setWorldState } from "../src/lib/embeddings/store";
import { physicalVectorId } from "../src/lib/embeddings/vectors";
import { clearSdkCache } from "../src/lib/world-db";
import {
  addWorld,
  chunkRows,
  deleteQuokka,
  http,
  importTurtle,
  KEPT,
  makeEnv,
  MODEL,
  REMOVED,
  search,
  seedReadyWorld,
  SECRET_KEY,
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

describe("physical vector ids", () => {
  it("match the installed @worlds/cloudflare VectorizeVectorSearchIndex", async () => {
    const mod: any =
      await import("../node_modules/@worlds/cloudflare/src/cloudflare/search-index/vector-search/vectorize-vector-search-index.js");
    const seen: string[] = [];
    const index = new mod.VectorizeVectorSearchIndex({
      worldId: WORLD_A,
      index: {
        deleteByIds: async (ids: string[]) => void seen.push(...ids),
      },
    });
    await index.deleteByIds(["result-id-1", "result-id-2"]);
    expect(seen).toEqual([
      await physicalVectorId(WORLD_A, "result-id-1"),
      await physicalVectorId(WORLD_A, "result-id-2"),
    ]);
    expect(seen[0]).toMatch(/^v\.[A-Za-z0-9_-]{43}$/);
  });
});

describe("vectors do not outlive deleted triples", () => {
  it("SPARQL delete removes the vector, its metadata text, and the orphaned chunk", async () => {
    const env = makeEnv();
    await seedReadyWorld(env);

    const res = await deleteQuokka(env, WORLD_A);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.vectorCleanup).toMatchObject({ attempted: 1, deleted: 1 });

    expect(vectorize.texts(WORLD_A)).toEqual([KEPT]);
    expect(chunkRows(WORLD_A).map((r) => r.value)).toEqual([KEPT]);
    const found = await search(env, WORLD_A, "quokka bamboo");
    expect(JSON.stringify(found)).not.toContain("quokka");
  });

  it("delete credential, delete triples, re-PUT key: removed text is never returned", async () => {
    const env = makeEnv();
    await seedReadyWorld(env);

    // Revoke the credential: no embedder can exist from here on.
    const revoke = await http(
      env,
      "ns-admin",
      "/namespaces/ns-1/embedding-providers/openai",
      { method: "DELETE" },
    );
    expect(revoke.status).toBe(204);
    expect((await getWorldState(env, WORLD_A))?.state).toBe("stale");

    // Triples are deleted while there is no embedder. Cleanup must not depend
    // on one: it is gated on the Vectorize binding.
    clearSdkCache();
    const del = await deleteQuokka(env, WORLD_A);
    expect(del.status).toBe(200);
    expect(vectorize.texts(WORLD_A)).toEqual([KEPT]);

    // Re-PUT a key. The world stays stale until reindex: nothing from before
    // the revoke becomes live again.
    const put = await http(
      env,
      "ns-admin",
      "/namespaces/ns-1/embedding-providers/openai",
      {
        method: "PUT",
        body: JSON.stringify({ apiKey: SECRET_KEY }),
      },
    );
    expect(put.status).toBe(200);
    clearSdkCache();
    expect((await getWorldState(env, WORLD_A))?.state).toBe("stale");

    const found = await search(env, WORLD_A, "quokka bamboo shoots");
    expect(found.mode).toBe("keyword");
    expect(JSON.stringify(found)).not.toContain("quokka");
  });

  it("is gated on the vector binding, not on an embedder: no KEK still clean", async () => {
    const env = makeEnv();
    await seedReadyWorld(env);

    const noEmbedder = makeEnv({ EMBEDDING_KEK_V1: undefined });
    clearSdkCache();
    const res = await deleteQuokka(noEmbedder, WORLD_A);
    expect(res.status).toBe(200);
    expect(vectorize.texts(WORLD_A)).toEqual([KEPT]);
  });

  it("a Vectorize outage is reported, keeps the rows needed to retry, and fails safe to stale", async () => {
    const env = makeEnv();
    await seedReadyWorld(env);
    vectorize.failDelete = true;

    const res = await deleteQuokka(env, WORLD_A);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.vectorCleanup).toMatchObject({ failed: 1, deleted: 0 });
    expect(body.vectorCleanup.errors.join()).toContain("delete");
    // Fail safe: the vector is still there but the world no longer serves it.
    expect(vectorize.texts(WORLD_A)).toContain(REMOVED);
    expect((await getWorldState(env, WORLD_A))?.state).toBe("stale");
    clearSdkCache();
    const found = await search(env, WORLD_A, "quokka bamboo");
    expect(found.mode).toBe("keyword");
    // The orphan row is the only way to find the id again: it must remain.
    expect(chunkRows(WORLD_A).map((r) => r.value)).toContain(REMOVED);

    // Retry once Vectorize is back (reindex runs the same cleanup first).
    vectorize.failDelete = false;
    const retry = await http(env, "w-token", `/worlds/${WORLD_A}/reindex`, {
      method: "POST",
    });
    expect(retry.status).toBe(200);
    expect(vectorize.texts(WORLD_A)).toEqual([KEPT]);
    expect(chunkRows(WORLD_A).map((r) => r.value)).toEqual([KEPT]);
  });

  it("never touches another world's vectors that carry the same text", async () => {
    const env = makeEnv();
    await addWorld(WORLD_B, "ns-1");
    await seedReadyWorld(env, WORLD_A);
    await setWorldState(env, WORLD_B, "ready", MODEL);
    expect((await importTurtle(env, WORLD_B, REMOVED)).status).toBe(200);
    expect(vectorize.texts(WORLD_B)).toEqual([REMOVED]);

    await deleteQuokka(env, WORLD_A);
    expect(vectorize.texts(WORLD_A)).toEqual([KEPT]);
    expect(vectorize.texts(WORLD_B)).toEqual([REMOVED]);
  });

  it("worlds that never had embedding state are left alone (inert)", async () => {
    const env = makeEnv();
    const res = await importTurtle(env, WORLD_A, REMOVED, KEPT);
    expect(res.status).toBe(200);
    expect(vectorize.store.size).toBe(0);
    const del = await deleteQuokka(env, WORLD_A);
    expect(((await del.json()) as any).vectorCleanup).toBeUndefined();
    expect(vectorize.deleteCalls).toBe(0);
  });
});
