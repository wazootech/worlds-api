import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "@/env";
import { EmbeddingError } from "@/lib/embeddings/errors";
import { embeddingFailureOf } from "@/lib/embeddings/failure";
import {
  getWorldState,
  setCredential,
  setWorldState,
} from "@/lib/embeddings/store";
import {
  addApiKey,
  addWorld,
  createSdkMock,
  http,
  makeEnv,
  MODEL,
  SECRET_KEY,
  seedLiteralQuads,
  useEmbeddingsHarness,
  WORLD_A,
} from "./helpers/byok-embeddings-harness";

vi.mock("@worlds/cloudflare", () => ({
  createCloudflareWorldsSdk: vi.fn(),
}));

useEmbeddingsHarness();

// @worlds/cloudflare (worlds-cloudflare#91, not yet released) throws when the
// embedding service fails, before writing anything. These tests stand in for
// it with a stub SDK that throws what the shared core throws: its
// "failed to vectorize literal chunk blocks" wrapper around our EmbeddingError.
function sdkError(code: ConstructorParameters<typeof EmbeddingError>[0]) {
  return new Error("failed to vectorize literal chunk blocks", {
    cause: new EmbeddingError(code),
  });
}
const wrongLength = () =>
  new Error(
    "embedding length 3 does not match configured vectorDimensions 1536",
  );

describe("embeddingFailureOf", () => {
  it("reads the embedder error out of the SDK wrapper, or the bare error", () => {
    expect(embeddingFailureOf(sdkError("timeout"))).toEqual({
      reason: "timeout",
    });
    expect(embeddingFailureOf(new EmbeddingError("auth"))).toEqual({
      reason: "auth",
    });
  });

  it("treats a wrong-length vector (no typed cause) as bad_response", () => {
    expect(embeddingFailureOf(wrongLength())).toEqual({
      reason: "bad_response",
    });
  });

  it("ignores everything else, including a cyclic cause chain", () => {
    expect(embeddingFailureOf(new Error("index build failed"))).toBeNull();
    expect(embeddingFailureOf("nope")).toBeNull();
    const loop = new Error("a");
    loop.cause = loop;
    expect(embeddingFailureOf(loop)).toBeNull();
  });
});

describe("a thrown embedding error", () => {
  const windows: string[][] = [];
  let failWith: (() => Error) | null;

  beforeEach(async () => {
    windows.length = 0;
    failWith = null;
    await addApiKey("w-token", "ns-1", ["data:read", "data:write"]);
    await addWorld(WORLD_A, "ns-1", MODEL);
    createSdkMock.mockImplementation((async (options: any) => {
      const throwIfFailing = () => {
        if (failWith) throw failWith();
      };
      return {
        import: async () => throwIfFailing(),
        sparql: async () => {
          throwIfFailing();
          return { kind: "void" };
        },
        reindex: async () => {
          const subjects: string[] = options.include?.subjects ?? [];
          windows.push(subjects);
          throwIfFailing();
          const n = Math.max(subjects.length, 1) * 2;
          return {
            processedQuadCount: n,
            chunkRowCount: n,
            vectorSync: {
              enabled: true,
              attempted: n,
              upserted: n,
              failedUpserts: 0,
              embeddingFailures: 0,
              staleDeleteFailures: 0,
              errors: [],
            },
          };
        },
      };
    }) as never);
  });

  const reindex = (env: Env) =>
    http(env, "w-token", `/worlds/${WORLD_A}/reindex`, { method: "POST" });
  const sparql = (env: Env, query: string) =>
    http(env, "w-token", `/worlds/${WORLD_A}/sparql`, {
      method: "POST",
      body: JSON.stringify({ query }),
    });
  const importData = (env: Env, data: string, contentType?: string) =>
    http(env, "w-token", `/worlds/${WORLD_A}/import`, {
      method: "POST",
      body: JSON.stringify({ data, contentType }),
    });

  async function liveEnv(extra: Partial<Env> = {}) {
    const env = makeEnv(extra);
    await setCredential(env, "ns-1", "openai", SECRET_KEY);
    return env;
  }

  it("fails reindex with a typed 502 and never marks the world ready", async () => {
    const env = await liveEnv();
    failWith = () => sdkError("provider_error");

    const res = await reindex(env);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: {
        code: "EMBEDDING_FAILED",
        message:
          "The embedding service failed (provider_error); nothing was written. Retry later.",
        reason: "provider_error",
      },
    });
    const state = await getWorldState(env, WORLD_A);
    expect(state?.state).toBe("stale");
    expect(state?.reindex_cursor).toBeNull();

    failWith = null;
    const retry = await reindex(env);
    expect(retry.status).toBe(200);
    expect((await getWorldState(env, WORLD_A))?.state).toBe("ready");
  });

  it("reports wrong-length vectors as 502 without echoing SDK text", async () => {
    const env = await liveEnv();
    failWith = wrongLength;
    const res = await reindex(env);
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(JSON.parse(text).error.reason).toBe("bad_response");
    expect(text).not.toContain("1536");
  });

  it("does not leak provider detail carried in the cause", async () => {
    const env = await liveEnv();
    failWith = () =>
      new Error("failed to vectorize literal chunk blocks", {
        cause: new Error(`401 for key ${SECRET_KEY}`),
      });
    const res = await reindex(env);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain(SECRET_KEY);
  });

  it("maps a budget that runs out mid-reindex to the existing 429", async () => {
    const env = await liveEnv();
    failWith = () => sdkError("budget_exceeded");
    const res = await reindex(env);
    expect(res.status).toBe(429);
    expect(((await res.json()) as any).error.code).toBe(
      "EMBEDDING_BUDGET_EXCEEDED",
    );
    expect((await getWorldState(env, WORLD_A))?.state).toBe("stale");
  });

  it("downgrades a ready world on a failed non-windowed reindex, never keeps it ready", async () => {
    const env = await liveEnv();
    await setWorldState(env, WORLD_A, "ready", MODEL);
    failWith = () => sdkError("timeout");
    expect((await reindex(env)).status).toBe(502);
    expect((await getWorldState(env, WORLD_A))?.state).toBe("stale");
  });

  it("keeps the windowed cursor so a retry re-runs the same window", async () => {
    const env = await liveEnv({ EMBEDDING_REINDEX_MAX_CHUNKS: "2" });
    seedLiteralQuads(["s1", "s2", "s3"], 2);

    expect(((await (await reindex(env)).json()) as any).status).toBe(
      "in_progress",
    );
    expect((await getWorldState(env, WORLD_A))?.reindex_cursor).toBe("s1");

    failWith = () => sdkError("rate_limited");
    const failed = await reindex(env);
    expect(failed.status).toBe(502);
    const state = await getWorldState(env, WORLD_A);
    expect(state?.reindex_cursor).toBe("s1");
    expect(state?.state).not.toBe("ready");

    failWith = null;
    for (const expected of ["in_progress", "completed"]) {
      expect(((await (await reindex(env)).json()) as any).status).toBe(
        expected,
      );
    }
    // s1 once; s2 failed then retried; s3 last. No window runs twice cleanly.
    expect(windows).toEqual([["s1"], ["s2"], ["s2"], ["s3"]]);
    expect((await getWorldState(env, WORLD_A))?.state).toBe("ready");
  });

  describe("write routes", () => {
    beforeEach(() => {
      failWith = () => sdkError("provider_error");
    });

    const body = (res: Response) => res.json() as Promise<any>;

    it("SPARQL update answers 502, not 400, and leaves state untouched", async () => {
      const env = await liveEnv();
      await setWorldState(env, WORLD_A, "ready", MODEL);
      const res = await sparql(env, 'INSERT DATA { <urn:s> <urn:p> "x" }');
      expect(res.status).toBe(502);
      expect((await body(res)).error.code).toBe("EMBEDDING_FAILED");
      expect((await getWorldState(env, WORLD_A))?.state).toBe("ready");
    });

    it("SPARQL update with a real client error is still 400", async () => {
      const env = await liveEnv();
      failWith = () => new Error("Parse error");
      expect((await sparql(env, "INSERT DATA {")).status).toBe(400);
    });

    for (const [name, data, contentType] of [
      ["turtle", '<urn:s> <urn:p> "x" .', undefined],
      ["json", "[]", "application/json"],
      ["text", "hello", "text/plain"],
    ] as const) {
      it(`import (${name}) answers 502 and leaves state untouched`, async () => {
        const env = await liveEnv();
        await setWorldState(env, WORLD_A, "ready", MODEL);
        const res = await importData(env, data, contentType);
        expect(res.status).toBe(502);
        expect((await body(res)).error.reason).toBe("provider_error");
        expect((await getWorldState(env, WORLD_A))?.state).toBe("ready");
      });
    }

    it("an unrelated import failure stays a 500", async () => {
      const env = await liveEnv();
      failWith = () => new Error("D1 is down");
      const res = await importData(env, "[]", "application/json");
      expect(res.status).toBe(500);
      expect((await body(res)).error.code).toBe("INTERNAL");
    });
  });
});
