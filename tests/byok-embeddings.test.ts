import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createCloudflareWorldsSdk } from "@worlds/cloudflare";
import app from "../src/app";
import type { Env } from "../src/env";
import { sha256Hex } from "../src/lib/crypto";
import { CONTROL_PLANE_DDL } from "../src/lib/d1-schema";
import {
  credentialAad,
  currentKek,
  kekForVersion,
  openKey,
  sealKey,
} from "../src/lib/embeddings/envelope";
import { EmbeddingError } from "../src/lib/embeddings/errors";
import { getEmbeddingModel } from "../src/lib/embeddings/catalog";
import {
  OPENAI_EMBEDDINGS_URL,
  createOpenAiEmbeddingService,
} from "../src/lib/embeddings/openai";
import { resolveEmbeddingService } from "../src/lib/embeddings/service";
import {
  AUTH_FAILURE_THRESHOLD,
  computeEmbeddingStatus,
  getCredential,
  getWorldState,
  invalidateKeyCache,
  recordAuthFailure,
  remainingBudget,
  reserveBudget,
  resolveApiKey,
  revokeCredential,
  setCredential,
  setWorldState,
} from "../src/lib/embeddings/store";
import { clearSdkCache, getWorldSdk } from "../src/lib/world-db";
import { createSqliteD1, type SqliteD1 } from "./helpers/sqlite-d1";

vi.mock("@worlds/cloudflare", () => ({
  createCloudflareWorldsSdk: vi.fn(),
}));
const createSdkMock = vi.mocked(createCloudflareWorldsSdk);

const SECRET_KEY = "sk-test-SECRET-0123456789abcdefghij";
const WORLD_A = "w_00000000000000000000000001";
const WORLD_B = "w_00000000000000000000000002";
const MODEL = "openai/text-embedding-3-small";
const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

function randomKek(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}

let db: SqliteD1;
let kek1: string;
let kek2: string;

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: db as unknown as Env["DB"],
    WORLDS_API_ADMIN_KEY: "admin-key",
    RATE_LIMIT_RPM: "0",
    EMBEDDING_PROVIDER: "byok",
    EMBEDDING_KEK_V1: kek1,
    VECTORIZE_INDEX: { query: vi.fn() } as unknown as Env["VECTORIZE_INDEX"],
    ...overrides,
  } as Env;
}

function vec(): number[] {
  return Array.from({ length: 1536 }, (_, i) => (i % 7) / 7);
}

function openAiOk(inputs: number) {
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

async function addApiKey(
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

async function addWorld(
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

function http(
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

describe("envelope encryption", () => {
  const aad = credentialAad("ns", "cred-1", "openai");

  it("round-trips and uses a fresh IV per seal", async () => {
    const kek = (await currentKek(makeEnv()))!;
    const a = await sealKey(kek, SECRET_KEY, aad);
    const b = await sealKey(kek, SECRET_KEY, aad);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toContain(SECRET_KEY);
    expect(await openKey(kek, a, aad)).toBe(SECRET_KEY);
  });

  it("rejects tampered ciphertext, wrong AAD (other namespace), and wrong KEK", async () => {
    const env = makeEnv({ EMBEDDING_KEK_V2: kek2 });
    const kek = (await kekForVersion(env, 1))!;
    const other = (await kekForVersion(env, 2))!;
    const sealed = await sealKey(kek, SECRET_KEY, aad);

    const flipped = atob(sealed.ciphertext).split("");
    flipped[0] = String.fromCharCode(flipped[0].charCodeAt(0) ^ 1);
    expect(
      await openKey(
        kek,
        { ...sealed, ciphertext: btoa(flipped.join("")) },
        aad,
      ),
    ).toBeNull();
    expect(
      await openKey(kek, sealed, credentialAad("other-ns", "cred-1", "openai")),
    ).toBeNull();
    expect(await openKey(other, sealed, aad)).toBeNull();
  });

  it("treats an absent or malformed KEK as unavailable", async () => {
    expect(
      await currentKek(makeEnv({ EMBEDDING_KEK_V1: undefined })),
    ).toBeNull();
    expect(
      await currentKek(makeEnv({ EMBEDDING_KEK_V1: "c2hvcnQ=" })),
    ).toBeNull();
    expect(await currentKek(makeEnv({ EMBEDDING_KEK_V1: "!!!" }))).toBeNull();
  });
});

describe("credential store", () => {
  it("fails closed with no KEK and writes nothing", async () => {
    const env = makeEnv({ EMBEDDING_KEK_V1: undefined });
    expect(await setCredential(env, "ns", "openai", SECRET_KEY)).toEqual({
      ok: false,
      reason: "kek_unavailable",
    });
    expect(await getCredential(env, "ns")).toBeNull();
  });

  it("stores ciphertext only, exposes fingerprint/last4, and resolves the key", async () => {
    const env = makeEnv();
    const res = await setCredential(env, "ns", "openai", SECRET_KEY);
    expect(res.ok).toBe(true);
    const row = await getCredential(env, "ns");
    expect(JSON.stringify(row)).not.toContain(SECRET_KEY);
    expect(row?.last4).toBe(SECRET_KEY.slice(-4));
    expect(row?.fingerprint).toBe((await sha256Hex(SECRET_KEY)).slice(0, 8));
    expect((await resolveApiKey(env, "ns"))?.key).toBe(SECRET_KEY);
  });

  it("returns null (never throws) for tampered rows and rows moved across namespaces", async () => {
    const env = makeEnv();
    await setCredential(env, "ns-a", "openai", SECRET_KEY);
    await setCredential(env, "ns-b", "openai", "sk-other-key-0123456789abcdef");
    invalidateKeyCache();
    const a = (await getCredential(env, "ns-a"))!;
    // Replay ns-a's sealed key under ns-b.
    db.raw
      .prepare(
        "UPDATE embedding_credentials SET ciphertext = ?, iv = ? WHERE namespace = 'ns-b'",
      )
      .run(a.ciphertext, a.iv);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await resolveApiKey(env, "ns-b")).toBeNull();

    db.raw.exec(
      "UPDATE embedding_credentials SET ciphertext = 'AAAA' WHERE namespace = 'ns-a'",
    );
    invalidateKeyCache();
    expect(await resolveApiKey(env, "ns-a")).toBeNull();
  });

  it("revoke erases ciphertext and the key stops resolving immediately", async () => {
    const env = makeEnv();
    await setCredential(env, "ns", "openai", SECRET_KEY);
    expect(await resolveApiKey(env, "ns")).not.toBeNull();
    expect(await revokeCredential(env, "ns")).toBe(1);
    const row = await getCredential(env, "ns");
    expect(row?.status).toBe("revoked");
    expect(row?.ciphertext).toBeNull();
    expect(await resolveApiKey(env, "ns")).toBeNull();
  });

  it("marks the credential invalid after consecutive auth failures", async () => {
    const env = makeEnv();
    const { row } = (await setCredential(env, "ns", "openai", SECRET_KEY)) as {
      row: { credential_id: string };
    };
    for (let i = 0; i < AUTH_FAILURE_THRESHOLD; i++) {
      expect((await getCredential(env, "ns"))?.status).toBe("active");
      await recordAuthFailure(env, row.credential_id);
    }
    expect((await getCredential(env, "ns"))?.status).toBe("invalid");
    expect(await resolveApiKey(env, "ns")).toBeNull();
  });

  it("lazily re-wraps under a newer KEK on use", async () => {
    await setCredential(makeEnv(), "ns", "openai", SECRET_KEY);
    invalidateKeyCache();
    const rotated = makeEnv({ EMBEDDING_KEK_V2: kek2 });
    expect((await resolveApiKey(rotated, "ns"))?.key).toBe(SECRET_KEY);
    expect((await getCredential(rotated, "ns"))?.kek_version).toBe(2);
    // V1 can be retired once swept.
    invalidateKeyCache();
    const v2Only = makeEnv({
      EMBEDDING_KEK_V1: undefined,
      EMBEDDING_KEK_V2: kek2,
    });
    expect((await resolveApiKey(v2Only, "ns"))?.key).toBe(SECRET_KEY);
  });
});

describe("budget guard", () => {
  it("reserves atomically and refuses once the daily budget is exhausted", async () => {
    const env = makeEnv({ EMBEDDING_DAILY_BUDGET: "10" });
    expect(await reserveBudget(env, "ns", 6, "index")).toBe(true);
    expect(await reserveBudget(env, "ns", 4, "query")).toBe(true);
    expect(await remainingBudget(env, "ns")).toBe(0);
    expect(await reserveBudget(env, "ns", 1, "query")).toBe(false);
    // Rejected reservations spend nothing; other namespaces are independent.
    expect(await remainingBudget(env, "ns")).toBe(0);
    expect(await reserveBudget(env, "other", 10, "index")).toBe(true);
    expect(await reserveBudget(env, "big", 11, "index")).toBe(false);
  });
});

describe("OpenAI provider", () => {
  const spec = getEmbeddingModel("openai/text-embedding-3-large")!;

  function service(fetchImpl: typeof fetch, overrides = {}) {
    return createOpenAiEmbeddingService({
      model: spec,
      getApiKey: async () => SECRET_KEY,
      reserve: async () => {},
      fetchImpl,
      sleep: async () => {},
      ...overrides,
    });
  }

  it("calls only the fixed endpoint, pins dimensions, and does not follow redirects", async () => {
    const fetchImpl = vi.fn(async () => openAiOk(2));
    const out = await service(fetchImpl as unknown as typeof fetch).embed([
      "a",
      "b",
    ]);
    expect(out).toHaveLength(2);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(OPENAI_EMBEDDINGS_URL);
    expect(init.redirect).toBe("manual");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: "text-embedding-3-large",
      dimensions: 1536,
      input: ["a", "b"],
    });
  });

  it("does not send dimensions for ada-002", async () => {
    const fetchImpl = vi.fn(async () => openAiOk(1));
    await createOpenAiEmbeddingService({
      model: getEmbeddingModel("openai/text-embedding-ada-002")!,
      getApiKey: async () => SECRET_KEY,
      reserve: async () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).embed(["a"]);
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string).dimensions).toBeUndefined();
  });

  it("gates on the budget BEFORE contacting the provider", async () => {
    const fetchImpl = vi.fn(async () => openAiOk(1));
    const svc = service(fetchImpl as unknown as typeof fetch, {
      reserve: async () => {
        throw new EmbeddingError("budget_exceeded");
      },
    });
    await expect(svc.embed(["a"])).rejects.toThrow("embedding budget exceeded");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps 401 to a fixed error, stops the run, and never echoes provider bodies or the key", async () => {
    const onAuthFailure = vi.fn();
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { message: `bad key ${SECRET_KEY} req_123` },
          }),
          { status: 401 },
        ),
    );
    const svc = service(fetchImpl as unknown as typeof fetch, {
      onAuthFailure,
    });
    const err = await svc.embed(["a"]).catch((e) => e as Error);
    expect(err).toBeInstanceOf(EmbeddingError);
    expect(err.message).toBe("embedding provider rejected the credential");
    expect(JSON.stringify(err)).not.toContain(SECRET_KEY);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    // Circuit open: no further provider calls this run.
    await expect(svc.embed(["b"])).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries 429 a bounded number of times then reports rate_limited", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("slow down", { status: 429 }),
    );
    const err = await service(fetchImpl as unknown as typeof fetch)
      .embed(["a"])
      .catch((e) => e as EmbeddingError);
    expect(err.code).toBe("rate_limited");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects wrong-width vectors and redirects", async () => {
    const short = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: [{ index: 0, embedding: [1, 2] }] }),
        ),
    );
    await expect(
      service(short as unknown as typeof fetch).embed(["a"]),
    ).rejects.toMatchObject({ code: "bad_response" });
    const redirect = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://evil" },
        }),
    );
    await expect(
      service(redirect as unknown as typeof fetch).embed(["a"]),
    ).rejects.toMatchObject({ code: "provider_error" });
  });

  it("collapses network errors that could embed request details", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError(`fetch failed for Bearer ${SECRET_KEY}`);
    });
    const err = await service(fetchImpl as unknown as typeof fetch)
      .embed(["a"])
      .catch((e) => e as Error);
    expect(err.message).not.toContain(SECRET_KEY);
  });
});

describe("resolveEmbeddingService fails closed", () => {
  const ref = { worldId: WORLD_A, namespace: "ns", embeddingModel: MODEL };

  async function ready(env: Env) {
    await setCredential(env, "ns", "openai", SECRET_KEY);
    await setWorldState(env, WORLD_A, "ready", MODEL);
  }

  it("returns a service only when every precondition holds", async () => {
    const env = makeEnv();
    await ready(env);
    expect(
      await resolveEmbeddingService(env, ref, { operation: "query" }),
    ).toBeDefined();
  });

  it.each([
    ["provider unset", { EMBEDDING_PROVIDER: undefined }],
    ["provider not byok", { EMBEDDING_PROVIDER: "workers-ai" }],
    ["no vectorize binding", { VECTORIZE_INDEX: undefined }],
    ["no KEK", { EMBEDDING_KEK_V1: undefined }],
  ])("keyword-only when %s", async (_name, patch) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await ready(makeEnv());
    const env = makeEnv(patch as Partial<Env>);
    expect(
      await resolveEmbeddingService(env, ref, { operation: "query" }),
    ).toBeUndefined();
  });

  it("keyword-only without a credential, after revoke, or for a non-allowlisted model", async () => {
    const env = makeEnv();
    await setWorldState(env, WORLD_A, "ready", MODEL);
    expect(
      await resolveEmbeddingService(env, ref, { operation: "query" }),
    ).toBeUndefined();
    await ready(env);
    await revokeCredential(env, "ns");
    expect(
      await resolveEmbeddingService(env, ref, { operation: "query" }),
    ).toBeUndefined();
    await setCredential(env, "ns", "openai", SECRET_KEY);
    expect(
      await resolveEmbeddingService(
        env,
        { ...ref, embeddingModel: "tfjs-universal-sentence-encoder" },
        { operation: "query" },
      ),
    ).toBeUndefined();
  });

  it("is stale-aware: keyword-only until reindex, but reindex itself may embed", async () => {
    const env = makeEnv();
    await ready(env);
    await setWorldState(env, WORLD_A, "stale", MODEL);
    expect(
      await resolveEmbeddingService(env, ref, { operation: "query" }),
    ).toBeUndefined();
    expect(
      await resolveEmbeddingService(env, ref, {
        operation: "index",
        forReindex: true,
      }),
    ).toBeDefined();
    // A state built with a different model is stale for this model.
    await setWorldState(env, WORLD_A, "ready", "openai/text-embedding-3-large");
    expect(
      await resolveEmbeddingService(env, ref, { operation: "query" }),
    ).toBeUndefined();
  });

  it("never throws when the database is broken", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = makeEnv({
      DB: {
        prepare: () => {
          throw new Error("boom");
        },
      } as never,
    });
    await expect(
      resolveEmbeddingService(env, ref, { operation: "query" }),
    ).resolves.toBeUndefined();
  });
});

describe("getWorldSdk wiring", () => {
  const ref = {
    worldId: WORLD_A,
    namespace: "ns",
    embeddingModel: MODEL,
    chunkSize: 1000,
    topK: 5,
    minScore: 0,
  };

  it("threads the embeddingService with pinned dimensions when ready", async () => {
    const env = makeEnv();
    await setCredential(env, "ns", "openai", SECRET_KEY);
    await setWorldState(env, WORLD_A, "ready", MODEL);
    await getWorldSdk(env, ref, 10);
    const options = createSdkMock.mock.calls[0][0] as Record<string, unknown>;
    expect(options.embeddingService).toBeDefined();
    expect(options.vectorDimensions).toBe(1536);
  });

  it("omits it (keyword-only, no throw) when stale or credential is absent", async () => {
    const env = makeEnv();
    await getWorldSdk(env, ref, 10);
    expect(createSdkMock.mock.calls[0][0]).not.toHaveProperty(
      "embeddingService",
    );
  });
});

describe("computeEmbeddingStatus", () => {
  const base = { enabled: true, model: MODEL };
  it("derives the vocabulary", () => {
    expect(
      computeEmbeddingStatus({
        ...base,
        enabled: false,
        credentialStatus: "active",
        state: undefined,
      }),
    ).toBe("unconfigured");
    expect(
      computeEmbeddingStatus({
        ...base,
        model: "tfjs-universal-sentence-encoder",
        credentialStatus: "active",
        state: undefined,
      }),
    ).toBe("unconfigured");
    expect(
      computeEmbeddingStatus({
        ...base,
        credentialStatus: undefined,
        state: undefined,
      }),
    ).toBe("no_credential");
    expect(
      computeEmbeddingStatus({
        ...base,
        credentialStatus: "revoked",
        state: undefined,
      }),
    ).toBe("no_credential");
    expect(
      computeEmbeddingStatus({
        ...base,
        credentialStatus: "invalid",
        state: undefined,
      }),
    ).toBe("invalid");
    expect(
      computeEmbeddingStatus({
        ...base,
        credentialStatus: "active",
        state: undefined,
      }),
    ).toBe("stale");
    expect(
      computeEmbeddingStatus({
        ...base,
        credentialStatus: "active",
        state: { state: "partial", model: MODEL },
      }),
    ).toBe("partial");
    expect(
      computeEmbeddingStatus({
        ...base,
        credentialStatus: "active",
        state: { state: "ready", model: MODEL },
      }),
    ).toBe("ready");
  });
});

describe("credential routes", () => {
  const path = "/namespaces/ns-1/embedding-credential";
  const put = (
    env: Env,
    token: string | null,
    body: unknown = { provider: "openai", apiKey: SECRET_KEY },
  ) => http(env, token, path, { method: "PUT", body: JSON.stringify(body) });

  beforeEach(async () => {
    await addApiKey("ns-admin-token", "ns-1", ["embeddings:admin"]);
    await addApiKey("ns-default-token", "ns-1", ["data:read", "data:write"]);
    await addApiKey(
      "ns-world-token",
      "ns-1",
      ["data:read", "data:write", "embeddings:admin"],
      WORLD_A,
    );
    await addApiKey("other-ns-token", "ns-2", ["embeddings:admin"]);
  });

  it("stores, reports metadata only, and never returns or logs the key", async () => {
    const logs: unknown[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => {
        logs.push(args);
      });
    }
    const env = makeEnv();

    const res = await put(env, "ns-admin-token");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(SECRET_KEY);
    expect(JSON.parse(text)).toMatchObject({
      provider: "openai",
      status: "active",
      last4: SECRET_KEY.slice(-4),
    });

    const got = await http(env, "ns-admin-token", path);
    expect(got.status).toBe(200);
    expect(await got.text()).not.toContain(SECRET_KEY);

    // Bad key format: rejected without echoing the input.
    const bad = await put(env, "ns-admin-token", {
      provider: "openai",
      apiKey: "has space  inside-it-which-is-bad",
    });
    expect(bad.status).toBe(400);
    expect(await bad.text()).not.toContain("inside-it");

    expect(JSON.stringify(logs)).not.toContain(SECRET_KEY);
  });

  it("requires the embeddings:admin scope; default grants and world tokens are refused", async () => {
    const env = makeEnv();
    expect((await put(env, "ns-default-token")).status).toBe(403);
    expect((await http(env, "ns-default-token", path)).status).toBe(403);
    expect(
      (await http(env, "ns-default-token", path, { method: "DELETE" })).status,
    ).toBe(403);
    expect((await put(env, "ns-world-token")).status).toBe(403);
    expect((await put(env, null)).status).toBe(401);
    expect((await put(env, "other-ns-token")).status).toBe(403);
    expect(await getCredential(env, "ns-1")).toBeNull();
    expect((await put(env, "admin-key")).status).toBe(200);
  });

  it("fails closed with 503 when the deployment has no KEK", async () => {
    const env = makeEnv({ EMBEDDING_KEK_V1: undefined });
    const res = await put(env, "ns-admin-token");
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error.code).toBe(
      "EMBEDDINGS_NOT_CONFIGURED",
    );
    expect(await getCredential(env, "ns-1")).toBeNull();
  });

  it("revokes via DELETE and 404s when there is nothing to revoke", async () => {
    const env = makeEnv();
    expect(
      (await http(env, "ns-admin-token", path, { method: "DELETE" })).status,
    ).toBe(404);
    await put(env, "ns-admin-token");
    expect(
      (await http(env, "ns-admin-token", path, { method: "DELETE" })).status,
    ).toBe(204);
    const got = await http(env, "ns-admin-token", path);
    expect(((await got.json()) as any).status).toBe("revoked");
  });

  it("namespace deletion revokes the credential", async () => {
    const env = makeEnv();
    await put(env, "ns-admin-token");
    const res = await http(env, "admin-key", "/admin/namespaces/ns-1/delete", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect((await getCredential(env, "ns-1"))?.status).toBe("revoked");
  });
});

describe("worlds: validation, stale-on-model-change, status", () => {
  beforeEach(async () => {
    await addApiKey("w-token", "ns-1", ["data:read", "data:write"]);
    await addApiKey("ns-admin-token", "ns-1", ["embeddings:admin"]);
    await addWorld(WORLD_A, "ns-1");
  });

  const patch = (env: Env, body: unknown) =>
    http(env, "w-token", `/worlds/${WORLD_A}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });

  it("rejects non-allowlisted models on create and PATCH", async () => {
    const env = makeEnv();
    expect(
      (await patch(env, { embeddingModel: "cohere/embed-v4" })).status,
    ).toBe(400);
    const create = await http(env, "w-token", "/worlds", {
      method: "POST",
      body: JSON.stringify({ embeddingModel: "https://evil.example/embed" }),
    });
    expect(create.status).toBe(400);
  });

  it("existing non-allowlisted values read as unconfigured", async () => {
    const res = await http(makeEnv(), "w-token", `/worlds/${WORLD_A}`);
    const body = (await res.json()) as any;
    expect(body.embeddingModel).toBe("tfjs-universal-sentence-encoder");
    expect(body.embeddingStatus).toBe("unconfigured");
  });

  it("requires a credential to choose a model", async () => {
    const res = await patch(makeEnv(), { embeddingModel: MODEL });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe(
      "EMBEDDING_CREDENTIAL_REQUIRED",
    );
  });

  it("marks the world stale on model change and stays keyword-only until reindex", async () => {
    const env = makeEnv();
    await setCredential(env, "ns-1", "openai", SECRET_KEY);
    await setWorldState(env, WORLD_A, "ready", MODEL);
    await db
      .prepare("UPDATE worlds SET embedding_model = ? WHERE world_id = ?")
      .bind(MODEL, WORLD_A)
      .run();
    expect(
      ((await (await http(env, "w-token", `/worlds/${WORLD_A}`)).json()) as any)
        .embeddingStatus,
    ).toBe("ready");

    const res = await patch(env, {
      embeddingModel: "openai/text-embedding-3-large",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.embeddingModel).toBe("openai/text-embedding-3-large");
    expect(body.embeddingStatus).toBe("stale");
    expect(await getWorldState(env, WORLD_A)).toMatchObject({
      state: "stale",
      model: "openai/text-embedding-3-large",
    });

    // Search wiring: no embedder while stale.
    clearSdkCache();
    await getWorldSdk(
      env,
      {
        worldId: WORLD_A,
        namespace: "ns-1",
        embeddingModel: "openai/text-embedding-3-large",
        chunkSize: 1000,
        topK: 5,
        minScore: 0,
      },
      10,
    );
    expect(createSdkMock.mock.calls.at(-1)![0]).not.toHaveProperty(
      "embeddingService",
    );
  });

  it("an unchanged model does not reset state", async () => {
    const env = makeEnv();
    await setCredential(env, "ns-1", "openai", SECRET_KEY);
    await db
      .prepare("UPDATE worlds SET embedding_model = ? WHERE world_id = ?")
      .bind(MODEL, WORLD_A)
      .run();
    await setWorldState(env, WORLD_A, "ready", MODEL);
    await patch(env, { embeddingModel: MODEL, displayName: "renamed" });
    expect((await getWorldState(env, WORLD_A))?.state).toBe("ready");
  });
});

describe("reindex end to end with a fake provider", () => {
  beforeEach(async () => {
    await addApiKey("w-token", "ns-1", ["data:read", "data:write"]);
    await addWorld(WORLD_A, "ns-1", MODEL);
  });

  const reindex = (env: Env) =>
    http(env, "w-token", `/worlds/${WORLD_A}/reindex`, { method: "POST" });

  function engineThatEmbeds(texts: string[]) {
    createSdkMock.mockImplementation((async (options: any) => ({
      reindex: async () => {
        const report = {
          processedQuadCount: texts.length,
          chunkRowCount: texts.length,
          vectorSync: {
            enabled: Boolean(options.embeddingService),
            attempted: 0,
            upserted: 0,
            failedUpserts: 0,
            embeddingFailures: 0,
            staleDeleteFailures: 0,
            errors: [] as string[],
          },
        };
        if (options.embeddingService) {
          try {
            const vectors = await options.embeddingService.embed(texts);
            report.vectorSync.attempted = vectors.length;
            report.vectorSync.upserted = vectors.length;
          } catch (error) {
            report.vectorSync.embeddingFailures = texts.length;
            report.vectorSync.errors.push(`embed: ${(error as Error).message}`);
          }
        }
        return report;
      },
    })) as never);
  }

  it("a successful reindex flips the world to ready and spends budget", async () => {
    const env = makeEnv();
    await setCredential(env, "ns-1", "openai", SECRET_KEY);
    const fetchMock = vi.fn(async () => openAiOk(3));
    vi.stubGlobal("fetch", fetchMock);
    engineThatEmbeds(["a", "b", "c"]);

    const res = await reindex(env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("completed");
    expect(body.vectorSync.upserted).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await getWorldState(env, WORLD_A))?.state).toBe("ready");
    expect(await remainingBudget(env, "ns-1")).toBe(20_000 - 3);
    const world = (await (
      await http(env, "w-token", `/worlds/${WORLD_A}`)
    ).json()) as any;
    expect(world.embeddingStatus).toBe("ready");
  });

  it("returns 429 EMBEDDING_BUDGET_EXCEEDED without calling the provider when exhausted", async () => {
    const env = makeEnv({ EMBEDDING_DAILY_BUDGET: "5" });
    await setCredential(env, "ns-1", "openai", SECRET_KEY);
    await reserveBudget(env, "ns-1", 5, "index");
    const fetchMock = vi.fn(async () => openAiOk(1));
    vi.stubGlobal("fetch", fetchMock);
    engineThatEmbeds(["a"]);

    const res = await reindex(env);
    expect(res.status).toBe(429);
    expect(((await res.json()) as any).error.code).toBe(
      "EMBEDDING_BUDGET_EXCEEDED",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mid-run budget exhaustion surfaces as vectorSync embedding failures, not a throw", async () => {
    const env = makeEnv({ EMBEDDING_DAILY_BUDGET: "2" });
    await setCredential(env, "ns-1", "openai", SECRET_KEY);
    const fetchMock = vi.fn(async () => openAiOk(3));
    vi.stubGlobal("fetch", fetchMock);
    engineThatEmbeds(["a", "b", "c"]);

    const res = await reindex(env);
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.status).toBe("completed_with_vector_errors");
    expect(body.vectorSync.errors).toEqual([
      "embed: embedding budget exceeded",
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await getWorldState(env, WORLD_A))?.state).toBe("stale");
  });

  it("reindex without a credential still rebuilds keyword indexes and leaves state alone", async () => {
    const env = makeEnv();
    engineThatEmbeds(["a"]);
    const res = await reindex(env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).vectorSync.enabled).toBe(false);
    expect(await getWorldState(env, WORLD_A)).toBeNull();
  });

  it("a provider 401 is redacted in vectorSync.errors and counted against the credential", async () => {
    const env = makeEnv();
    await setCredential(env, "ns-1", "openai", SECRET_KEY);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(`nope ${SECRET_KEY}`, { status: 401 })),
    );
    engineThatEmbeds(["a"]);
    const res = await reindex(env);
    const text = await res.text();
    expect(text).not.toContain(SECRET_KEY);
    expect(JSON.parse(text).vectorSync.errors).toEqual([
      "embed: embedding provider rejected the credential",
    ]);
    expect((await getCredential(env, "ns-1"))?.consecutive_auth_failures).toBe(
      1,
    );
  });
});
