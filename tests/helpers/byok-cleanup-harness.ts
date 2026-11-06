import { afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import app from "../../src/app";
import type { Env } from "../../src/env";
import { sha256Hex } from "../../src/lib/crypto";
import { CONTROL_PLANE_DDL } from "../../src/lib/d1-schema";
import {
  invalidateKeyCache,
  setCredential,
  setWorldState,
} from "../../src/lib/embeddings/store";
import { clearSdkCache } from "../../src/lib/world-db";
import { createSqliteD1, type SqliteD1 } from "./sqlite-d1";

/**
 * Shared fixtures for the byok vector-cleanup tests: a sqlite-backed D1 shim, an
 * in-memory Vectorize and a fake OpenAI. The calling test files declare the
 * `@worlds/cloudflare` vi.mock (see byok-vector-cleanup.test.ts) and call
 * useCleanupHarness(). `db`, `vectorize`, `kek` and `fetchMock` are live
 * bindings, reassigned by the hooks.
 */

export const SECRET_KEY = "sk-test-SECRET-0123456789abcdefghij";
export const WORLD_A = "w_00000000000000000000000001";
export const WORLD_B = "w_00000000000000000000000002";
export const MODEL = "openai/text-embedding-3-small";
export const REMOVED = "The quokka eats bamboo shoots at dawn";
export const KEPT = "Penguins glide through icy water";
export const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

export function embedText(text: string): number[] {
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
export class FakeVectorize {
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

export let db: SqliteD1;
export let vectorize: FakeVectorize;
export let kek: string;
export let fetchMock: ReturnType<typeof vi.fn>;

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: db as unknown as Env["DB"],
    WORLDS_API_ADMIN_KEY: "admin-key",
    RATE_LIMIT_RPM: "0",
    EMBEDDING_KEK_V1: kek,
    VECTORIZE_INDEX: vectorize as unknown as Env["VECTORIZE_INDEX"],
    ...overrides,
  } as Env;
}

export async function addApiKey(
  token: string,
  namespace: string,
  scopes: string[],
) {
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

export async function addWorld(
  worldId: string,
  namespace: string,
  model = MODEL,
) {
  await db
    .prepare(
      "INSERT INTO worlds (world_id, namespace, display_name, embedding_model) VALUES (?, ?, 'w', ?)",
    )
    .bind(worldId, namespace, model)
    .run();
}

export function http(
  env: Env,
  token: string,
  path: string,
  init: RequestInit = {},
) {
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

export const importTurtle = (env: Env, worldId: string, ...texts: string[]) =>
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

export const sparql = (env: Env, worldId: string, query: string) =>
  http(env, "w-token", `/worlds/${worldId}/sparql`, {
    method: "POST",
    body: JSON.stringify({ query }),
  });

export const search = async (env: Env, worldId: string, query: string) =>
  (await (
    await http(env, "w-token", `/worlds/${worldId}/search`, {
      method: "POST",
      body: JSON.stringify({ query, minScore: 0 }),
    })
  ).json()) as { results: Array<{ content: string }>; mode: string };

export const chunkRows = (worldId: string) =>
  db.raw
    .prepare(
      "SELECT value, vector IS NOT NULL AS has_vec FROM chunks WHERE world_id = ?",
    )
    .all(worldId) as Array<{ value: string; has_vec: number }>;

export function deleteQuokka(env: Env, worldId: string) {
  return sparql(
    env,
    worldId,
    `DELETE DATA { <urn:s:${worldId}:0> <http://schema.org/description> "${REMOVED}" }`,
  );
}

export function useCleanupHarness() {
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
}

/** Credential + ready world + two imported chunks with live vectors. */
export async function seedReadyWorld(env: Env, worldId = WORLD_A) {
  await setCredential(env, "ns-1", "openai", SECRET_KEY);
  await setWorldState(env, worldId, "ready", MODEL);
  const res = await importTurtle(env, worldId, REMOVED, KEPT);
  expect(res.status).toBe(200);
  expect(vectorize.texts(worldId).sort()).toEqual([KEPT, REMOVED].sort());
}
