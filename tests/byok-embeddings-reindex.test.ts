import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import {} from "../src/lib/embeddings/envelope";
import {} from "../src/lib/embeddings/catalog";
import {} from "../src/lib/embeddings/provider";
import { planReindexWindow } from "../src/lib/embeddings/reindex-window";
import {
  computeEmbeddingStatus,
  getCredential,
  getWorldState,
  remainingBudget,
  reserveBudget,
  setCredential,
} from "../src/lib/embeddings/store";
import {
  addApiKey,
  addWorld,
  createSdkMock,
  db,
  http,
  makeEnv,
  MODEL,
  openAiOk,
  SECRET_KEY,
  seedLiteralQuads,
  useEmbeddingsHarness,
  WORLD_A,
} from "./helpers/byok-embeddings-harness";

vi.mock("@worlds/cloudflare", () => ({
  createCloudflareWorldsSdk: vi.fn(),
}));

useEmbeddingsHarness();

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
    expect(
      (await getCredential(env, "ns-1", "openai"))?.consecutive_auth_failures,
    ).toBe(1);
  });

  it("reindexes a world larger than the cap in windows, resuming where it stopped", async () => {
    const env = makeEnv({ EMBEDDING_REINDEX_MAX_CHUNKS: "2" });
    await setCredential(env, "ns-1", "openai", SECRET_KEY);
    // Three subjects, two literal quads each, cap of two: three windows.
    seedLiteralQuads(["s1", "s2", "s3"], 2);

    const windows: string[][] = [];
    createSdkMock.mockImplementation((async (options: any) => ({
      reindex: async () => {
        const subjects: string[] = options.include?.subjects ?? [];
        windows.push(subjects);
        const count = subjects.length * 2;
        return {
          processedQuadCount: count,
          chunkRowCount: count,
          vectorSync: {
            enabled: Boolean(options.embeddingService),
            attempted: count,
            upserted: count,
            failedUpserts: 0,
            embeddingFailures: 0,
            staleDeleteFailures: 0,
            errors: [],
          },
        };
      },
    })) as never);

    const first = (await (await reindex(env)).json()) as any;
    expect(first.status).toBe("in_progress");
    expect(first.continuation.remainingChunksEstimate).toBe(4);
    expect(windows).toEqual([["s1"]]);
    expect((await getWorldState(env, WORLD_A))?.reindex_cursor).toBe("s1");

    const second = (await (await reindex(env)).json()) as any;
    expect(second.status).toBe("in_progress");
    expect((await getWorldState(env, WORLD_A))?.reindex_cursor).toBe("s2");

    const third = (await (await reindex(env)).json()) as any;
    expect(third.status).toBe("completed");
    // No subject is embedded twice across the whole pass.
    expect(windows).toEqual([["s1"], ["s2"], ["s3"]]);
    const state = await getWorldState(env, WORLD_A);
    expect(state?.state).toBe("ready");
    expect(state?.reindex_cursor).toBeNull();
  });
});

describe("reindex window planning", () => {
  it("leaves a world that fits in one call unwindowed", async () => {
    seedLiteralQuads(["s1", "s2", "s3"]);
    const env = makeEnv({ EMBEDDING_REINDEX_MAX_CHUNKS: "5" });
    expect(await planReindexWindow(env, WORLD_A, null)).toEqual({
      windowed: false,
    });
  });

  it("splits whole subjects into a window and reports what is left", async () => {
    seedLiteralQuads(["s1", "s2", "s3"], 2);
    const env = makeEnv({ EMBEDDING_REINDEX_MAX_CHUNKS: "2" });
    expect(await planReindexWindow(env, WORLD_A, null)).toEqual({
      windowed: true,
      subjects: ["s1"],
      lastSubject: "s1",
      done: false,
      remaining: 4,
    });
  });

  it("takes a single subject larger than the cap alone rather than stalling", async () => {
    seedLiteralQuads(["big", "s2"], 3);
    const env = makeEnv({ EMBEDDING_REINDEX_MAX_CHUNKS: "2" });
    expect(await planReindexWindow(env, WORLD_A, null)).toMatchObject({
      windowed: true,
      subjects: ["big"],
      done: false,
    });
  });

  it("finishes a resumed pass with nothing left after the cursor", async () => {
    seedLiteralQuads(["s1"], 2);
    const env = makeEnv({ EMBEDDING_REINDEX_MAX_CHUNKS: "2" });
    expect(await planReindexWindow(env, WORLD_A, "s1")).toEqual({
      windowed: true,
      subjects: [],
      lastSubject: "s1",
      done: true,
      remaining: 0,
    });
  });

  it("stays unwindowed before the world has any quads table", async () => {
    db.raw.exec("DROP TABLE IF EXISTS quads");
    const env = makeEnv({ EMBEDDING_REINDEX_MAX_CHUNKS: "2" });
    expect(await planReindexWindow(env, WORLD_A, null)).toEqual({
      windowed: false,
    });
  });
});
