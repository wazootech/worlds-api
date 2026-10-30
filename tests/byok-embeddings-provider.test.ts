import { assert, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import {} from "../src/lib/embeddings/envelope";
import { EmbeddingError } from "../src/lib/embeddings/errors";
import {
  EMBEDDING_PROVIDERS,
  getEmbeddingModel,
} from "../src/lib/embeddings/catalog";
import {
  INDEX_MAX_RETRIES,
  INDEX_TIMEOUT_MS,
  QUERY_TIMEOUT_MS,
  createEmbeddingService,
} from "../src/lib/embeddings/provider";
import { resolveEmbeddingService } from "../src/lib/embeddings/service";
import {
  revokeCredential,
  setCredential,
  setWorldState,
} from "../src/lib/embeddings/store";
import { getWorldSdk } from "../src/lib/world-db";
import {
  createSdkMock,
  makeEnv,
  MODEL,
  openAiOk,
  SECRET_KEY,
  useEmbeddingsHarness,
  WORLD_A,
} from "./helpers/byok-embeddings-harness";

vi.mock("@worlds/cloudflare", () => ({
  createCloudflareWorldsSdk: vi.fn(),
}));

useEmbeddingsHarness();

describe("OpenAI provider", () => {
  const spec = getEmbeddingModel("openai/text-embedding-3-large")!;

  function service(fetchImpl: typeof fetch, overrides = {}) {
    return createEmbeddingService({
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
    expect(url).toBe(EMBEDDING_PROVIDERS.openai.embeddingsUrl);
    expect(init.redirect).toBe("manual");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: "text-embedding-3-large",
      dimensions: 1536,
      input: ["a", "b"],
    });
  });

  it("does not send dimensions for ada-002", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      openAiOk(1),
    );
    await createEmbeddingService({
      model: getEmbeddingModel("openai/text-embedding-ada-002")!,
      getApiKey: async () => SECRET_KEY,
      reserve: async () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).embed(["a"]);
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string).dimensions).toBeUndefined();
  });

  it("sends OpenRouter calls to the OpenRouter endpoint with the vendor-prefixed model", async () => {
    const fetchImpl = vi.fn(async () => openAiOk(1));
    await createEmbeddingService({
      model: getEmbeddingModel("openrouter/openai/text-embedding-3-small")!,
      getApiKey: async () => SECRET_KEY,
      reserve: async () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).embed(["a"]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://openrouter.ai/api/v1/embeddings");
    expect(url).toBe(EMBEDDING_PROVIDERS.openrouter.embeddingsUrl);
    expect(init.redirect).toBe("manual");
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "openai/text-embedding-3-small",
      dimensions: 1536,
    });
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
    const err = await svc.embed(["a"]).catch((e: unknown) => e);
    assert.instanceOf(err, EmbeddingError);
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
      .catch((e: unknown) => e);
    assert.instanceOf(err, EmbeddingError);
    expect(err.code).toBe("rate_limited");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("aborts a hung provider at the deadline and reports a timeout", async () => {
    const fetchImpl = vi.fn(
      async (_url: string, init: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          // A provider that never answers: the request only ends when the
          // deadline signal fires. No signal means the test hangs and fails.
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "TimeoutError")),
          );
        }),
    );
    const started = Date.now();
    const err = await service(fetchImpl as unknown as typeof fetch, {
      timeoutMs: 25,
    })
      .embed(["a"])
      .catch((e: unknown) => e);
    assert.instanceOf(err, EmbeddingError);
    expect(err.code).toBe("timeout");
    expect(err.message).toBe("embedding provider timed out");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(2_000);
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
      .catch((e: unknown) => e);
    assert.instanceOf(err, Error);
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
    await revokeCredential(env, "ns", "openai");
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

  it("gives search a short deadline and no retries, and writes a longer one with retries", async () => {
    const env = makeEnv();
    await ready(env);
    const fetchImpl = vi.fn(
      async () => new Response("slow down", { status: 429 }),
    );
    const sleep = vi.fn(async () => {});

    const query = await resolveEmbeddingService(env, ref, {
      operation: "query",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
    });
    await expect(query!.embed(["a"])).rejects.toMatchObject({
      code: "rate_limited",
    });
    // A search never retries and never sleeps inside the user's request.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(QUERY_TIMEOUT_MS).toBeLessThan(INDEX_TIMEOUT_MS);

    const index = await resolveEmbeddingService(env, ref, {
      operation: "index",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
    });
    await expect(index!.embed(["b"])).rejects.toMatchObject({
      code: "rate_limited",
    });
    // Writes keep the bounded retry: one attempt plus INDEX_MAX_RETRIES.
    expect(fetchImpl).toHaveBeenCalledTimes(1 + 1 + INDEX_MAX_RETRIES);
    expect(sleep).toHaveBeenCalledTimes(INDEX_MAX_RETRIES);
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
    const options = createSdkMock.mock.calls[0][0];
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
