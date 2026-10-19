import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import app from "../src/app";
import type { Env } from "../src/env";
import { sha256Hex } from "../src/lib/crypto";
import { CONTROL_PLANE_DDL } from "../src/lib/d1-schema";
import {
  getCredential,
  getWorldState,
  invalidateKeyCache,
  setCredential,
  setWorldState,
} from "../src/lib/embeddings/store";
import {
  cleanupWorldVectors,
  physicalVectorId,
} from "../src/lib/embeddings/vectors";
import { runPurgeSweep } from "../src/lib/purge";
import { clearSdkCache } from "../src/lib/world-db";
import { createSqliteD1, type SqliteD1 } from "./helpers/sqlite-d1";

/**
 * End-to-end vector lifecycle tests against the REAL @worlds/cloudflare SDK
 * (sqlite-backed D1 shim, in-memory Vectorize, fake OpenAI). They pin the
 * review's finding 1: vectors, and the chunk text in their metadata, must not
 * outlive the data.
 */

// vitest.config.ts aliases "@worlds/cloudflare" to a type stub (the package's
// source tree is not loadable through its public specifier here). This file
// wants the real engine, so it loads the package entry by path.
vi.mock(
  "@worlds/cloudflare",
  async () => await import("../node_modules/@worlds/cloudflare/src/mod.js"),
);
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const SECRET_KEY = "sk-test-SECRET-0123456789abcdefghij";
const WORLD_A = "w_00000000000000000000000001";
const WORLD_B = "w_00000000000000000000000002";
const MODEL = "openai/text-embedding-3-small";
const REMOVED = "The quokka eats bamboo shoots at dawn";
const KEPT = "Penguins glide through icy water";
const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

function embedText(text: string): number[] {
  const v = new Array<number>(1536).fill(0);
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!token) continue;
    let h = 7;
    for (const ch of token) h = (h * 31 + ch.charCodeAt(0)) % 1536;
    v[h] += 1;
  }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}

/** In-memory Vectorize with the binding surface the SDK uses. */
class FakeVectorize {
  store = new Map<
    string,
    { values: number[]; metadata: Record<string, string> }
  >();
  failDelete = false;
  deleteCalls = 0;

  async upsert(
    vectors: Array<{
      id: string;
      values: number[];
      metadata?: Record<string, string>;
    }>,
  ) {
    for (const v of vectors) {
      this.store.set(v.id, { values: v.values, metadata: v.metadata ?? {} });
    }
    return { count: vectors.length };
  }

  async deleteByIds(ids: string[]) {
    this.deleteCalls++;
    if (this.failDelete) throw new Error("vectorize unavailable");
    for (const id of ids) this.store.delete(id);
    return { count: ids.length };
  }

  async query(
    vector: number[],
    options: { topK?: number; filter?: Record<string, string> } = {},
  ) {
    const matches = [...this.store.entries()]
      .filter(([, v]) =>
        Object.entries(options.filter ?? {}).every(
          ([k, val]) => v.metadata[k] === val,
        ),
      )
      .map(([id, v]) => ({
        id,
        score: v.values.reduce((sum, x, i) => sum + x * vector[i]!, 0),
        metadata: v.metadata,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, options.topK ?? 10);
    return { matches, count: matches.length };
  }

  texts(worldId?: string): string[] {
    return [...this.store.values()]
      .filter((v) => !worldId || v.metadata.world_id === worldId)
      .map((v) => v.metadata.value!);
  }
}

let db: SqliteD1;
let vectorize: FakeVectorize;
let kek: string;
let fetchMock: ReturnType<typeof vi.fn>;

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: db as unknown as Env["DB"],
    WORLDS_API_ADMIN_KEY: "admin-key",
    RATE_LIMIT_RPM: "0",
    EMBEDDING_KEK_V1: kek,
    VECTORIZE_INDEX: vectorize as unknown as Env["VECTORIZE_INDEX"],
    ...overrides,
  } as Env;
}

async function addApiKey(token: string, namespace: string, scopes: string[]) {
  await db
    .prepare(
      "INSERT INTO api_keys (uid, key_hash, name, namespace, world_id, scopes) VALUES (?, ?, '', ?, NULL, ?)",
    )
    .bind(
      crypto.randomUUID(),
      await sha256Hex(token),
      namespace,
      JSON.stringify(scopes),
    )
    .run();
}

async function addWorld(worldId: string, namespace: string, model = MODEL) {
  await db
    .prepare(
      "INSERT INTO worlds (world_id, namespace, display_name, embedding_model) VALUES (?, ?, 'w', ?)",
    )
    .bind(worldId, namespace, model)
    .run();
}

function http(env: Env, token: string, path: string, init: RequestInit = {}) {
  return app.request(
    path,
    {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
    },
    env as unknown as Record<string, unknown>,
    executionCtx,
  );
}

const importTurtle = (env: Env, worldId: string, ...texts: string[]) =>
  http(env, "w-token", `/worlds/${worldId}/import`, {
    method: "POST",
    body: JSON.stringify({
      data: texts
        .map(
          (t, i) =>
            `<urn:s:${worldId}:${i}> <http://schema.org/description> "${t}" .`,
        )
        .join("\n"),
    }),
  });

const sparql = (env: Env, worldId: string, query: string) =>
  http(env, "w-token", `/worlds/${worldId}/sparql`, {
    method: "POST",
    body: JSON.stringify({ query }),
  });

const search = async (env: Env, worldId: string, query: string) =>
  (await (
    await http(env, "w-token", `/worlds/${worldId}/search`, {
      method: "POST",
      body: JSON.stringify({ query, minScore: 0 }),
    })
  ).json()) as { results: Array<{ content: string }>; mode: string };

const chunkRows = (worldId: string) =>
  db.raw
    .prepare(
      "SELECT value, vector IS NOT NULL AS has_vec FROM chunks WHERE world_id = ?",
    )
    .all(worldId) as Array<{ value: string; has_vec: number }>;

function deleteQuokka(env: Env, worldId: string) {
  return sparql(
    env,
    worldId,
    `DELETE DATA { <urn:s:${worldId}:0> <http://schema.org/description> "${REMOVED}" }`,
  );
}

beforeAll(async () => {
  db = createSqliteD1();
  for (const ddl of CONTROL_PLANE_DDL) await db.prepare(ddl).run();
  kek = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
  );
});

beforeEach(async () => {
  for (const table of [
    "worlds",
    "api_keys",
    "embedding_credentials",
    "world_embedding_state",
    "embedding_usage",
  ]) {
    db.raw.exec(`DELETE FROM ${table}`);
  }
  db.raw.exec("DROP TABLE IF EXISTS chunks_fts");
  db.raw.exec("DROP TABLE IF EXISTS chunks");
  db.raw.exec("DROP TABLE IF EXISTS quads");
  db.raw.exec("DROP TABLE IF EXISTS worlds_data_plane_schema");
  invalidateKeyCache();
  clearSdkCache();
  vectorize = new FakeVectorize();
  fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const inputs = JSON.parse(init.body).input as string[];
    return new Response(
      JSON.stringify({
        data: inputs.map((t, index) => ({ index, embedding: embedText(t) })),
      }),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await addApiKey("w-token", "ns-1", ["data:read", "data:write"]);
  await addApiKey("ns-admin", "ns-1", ["embeddings:admin"]);
  await addWorld(WORLD_A, "ns-1");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Credential + ready world + two imported chunks with live vectors. */
async function seedReadyWorld(env: Env, worldId = WORLD_A) {
  await setCredential(env, "ns-1", "openai", SECRET_KEY);
  await setWorldState(env, worldId, "ready", MODEL);
  const res = await importTurtle(env, worldId, REMOVED, KEPT);
  expect(res.status).toBe(200);
  expect(vectorize.texts(worldId).sort()).toEqual([KEPT, REMOVED].sort());
}

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
      "/namespaces/ns-1/embedding-credential",
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
      "/namespaces/ns-1/embedding-credential",
      {
        method: "PUT",
        body: JSON.stringify({ provider: "openai", apiKey: SECRET_KEY }),
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
    expect((await getCredential(env, "ns-1"))?.status).toBe("revoked");
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
