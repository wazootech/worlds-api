import { afterEach, beforeAll, beforeEach, vi } from "vitest";
import { createCloudflareWorldsSdk } from "@worlds/cloudflare";
import app from "../../src/app";
import type { Env } from "../../src/env";
import { sha256Hex } from "../../src/lib/crypto";
import { CONTROL_PLANE_DDL } from "../../src/lib/d1-schema";
import { invalidateKeyCache } from "../../src/lib/embeddings/store";
import { clearSdkCache } from "../../src/lib/world-db";
import { createSqliteD1, type SqliteD1 } from "./sqlite-d1";

/**
 * Shared fixtures for the byok-embeddings tests. The calling test files declare
 * the `@worlds/cloudflare` vi.mock and call useEmbeddingsHarness(). `db`, `kek1`
 * and `kek2` are live bindings, assigned by the hooks.
 */
export const createSdkMock = vi.mocked(createCloudflareWorldsSdk);

export const SECRET_KEY = "sk-test-SECRET-0123456789abcdefghij";
export const WORLD_A = "w_00000000000000000000000001";
export const MODEL = "openai/text-embedding-3-small";
export const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

export function randomKek(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}

export let db: SqliteD1;
export let kek1: string;
export let kek2: string;

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: db as unknown as Env["DB"],
    WORLDS_API_ADMIN_KEY: "admin-key",
    RATE_LIMIT_RPM: "0",
    EMBEDDING_KEK_V1: kek1,
    VECTORIZE_INDEX: { query: vi.fn() } as unknown as Env["VECTORIZE_INDEX"],
    ...overrides,
  } as Env;
}

export function vec(): number[] {
  return Array.from({ length: 1536 }, (_, i) => (i % 7) / 7);
}

export function openAiOk(inputs: number) {
  return new Response(
    JSON.stringify({
      data: Array.from({ length: inputs }, (_, index) => ({
        index,
        embedding: vec(),
      })),
    }),
    { status: 200 },
  );
}

export async function addApiKey(
  token: string,
  namespace: string,
  scopes: string[],
  worldId: string | null = null,
) {
  await db
    .prepare(
      "INSERT INTO api_keys (uid, key_hash, name, namespace, world_id, scopes) VALUES (?, ?, '', ?, ?, ?)",
    )
    .bind(
      crypto.randomUUID(),
      await sha256Hex(token),
      namespace,
      worldId,
      JSON.stringify(scopes),
    )
    .run();
}

export async function addWorld(
  worldId: string,
  namespace: string,
  model = "tfjs-universal-sentence-encoder",
) {
  await db
    .prepare(
      "INSERT INTO worlds (world_id, namespace, display_name, embedding_model) VALUES (?, ?, 'w', ?)",
    )
    .bind(worldId, namespace, model)
    .run();
}

/**
 * Seeds literal quads with the real column names the window planner reads
 * (`quads.world_id`, `quads.s`, `quads.o_type = 'Literal'`). The engine is
 * mocked in this file, so the table is created here rather than by the SDK.
 */
export function seedLiteralQuads(
  subjects: string[],
  perSubject = 1,
  worldId = WORLD_A,
): void {
  db.raw.exec("DROP TABLE IF EXISTS quads");
  db.raw.exec(
    "CREATE TABLE quads (quad_id TEXT PRIMARY KEY, world_id TEXT NOT NULL, s TEXT NOT NULL, o_type TEXT NOT NULL)",
  );
  const insert = db.raw.prepare(
    "INSERT INTO quads (quad_id, world_id, s, o_type) VALUES (?, ?, ?, 'Literal')",
  );
  let n = 0;
  for (const subject of subjects) {
    for (let i = 0; i < perSubject; i++) {
      insert.run(`q${n++}`, worldId, subject);
    }
  }
}

export function http(
  env: Env,
  token: string | null,
  path: string,
  init: RequestInit = {},
) {
  return app.request(
    path,
    {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    },
    env as unknown as Record<string, unknown>,
    executionCtx,
  );
}

export function useEmbeddingsHarness() {
  beforeAll(async () => {
    db = createSqliteD1();
    for (const ddl of CONTROL_PLANE_DDL) await db.prepare(ddl).run();
    kek1 = randomKek();
    kek2 = randomKek();
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
    invalidateKeyCache();
    clearSdkCache();
    createSdkMock.mockReset();
    createSdkMock.mockResolvedValue({} as never);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
}
