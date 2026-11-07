import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWorldState, setWorldState } from "../src/lib/embeddings/store";
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
import { setCredential } from "../src/lib/embeddings/store";

vi.mock("@worlds/cloudflare", () => ({
  createCloudflareWorldsSdk: vi.fn(),
}));

useEmbeddingsHarness();

// worlds-api#127: a write landing mid-pass on a world that cannot embed it
// (state stale) leaves vector-less chunks that the pass must not call ready.
describe("import during a windowed reindex", () => {
  const windows: string[][] = [];

  beforeEach(async () => {
    windows.length = 0;
    await addApiKey("w-token", "ns-1", ["data:read", "data:write"]);
    await addWorld(WORLD_A, "ns-1", MODEL);
    createSdkMock.mockImplementation((async (options: any) => ({
      import: async () => ({}),
      sparql: async () => ({ kind: "void" }),
      reindex: async () => {
        const subjects: string[] = options.include?.subjects ?? [];
        windows.push(subjects);
        const n = subjects.length * 2;
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
    })) as never);
  });

  const reindex = (env: ReturnType<typeof makeEnv>) =>
    http(env, "w-token", `/worlds/${WORLD_A}/reindex`, { method: "POST" });
  const importTriple = (env: ReturnType<typeof makeEnv>) =>
    http(env, "w-token", `/worlds/${WORLD_A}/import`, {
      method: "POST",
      body: JSON.stringify({ data: '<urn:s0> <urn:p> "late text" .' }),
    });
  const update = (env: ReturnType<typeof makeEnv>) =>
    http(env, "w-token", `/worlds/${WORLD_A}/sparql`, {
      method: "POST",
      body: JSON.stringify({ query: 'INSERT DATA { <urn:s0> <urn:p> "x" }' }),
    });

  async function midPass() {
    const env = makeEnv({ EMBEDDING_REINDEX_MAX_CHUNKS: "2" });
    await setCredential(env, "ns-1", "openai", SECRET_KEY);
    seedLiteralQuads(["s1", "s2", "s3"], 2);
    const first = (await (await reindex(env)).json()) as any;
    expect(first.status).toBe("in_progress");
    expect((await getWorldState(env, WORLD_A))?.reindex_cursor).toBe("s1");
    return env;
  }

  it("restarts the pass so subjects behind the cursor are re-embedded before ready", async () => {
    const env = await midPass();
    expect((await importTriple(env)).status).toBe(200);
    expect((await getWorldState(env, WORLD_A))?.reindex_cursor).toBeNull();

    // The next call starts over from the first subject instead of resuming
    // after s1, and the pass only reaches ready after covering everything.
    let last: any;
    for (let i = 0; i < 6 && last?.status !== "completed"; i++) {
      last = await (await reindex(env)).json();
    }
    expect(windows.slice(0, 2)).toEqual([["s1"], ["s1"]]);
    expect(windows.flat()).toEqual(["s1", "s1", "s2", "s3"]);
    expect((await getWorldState(env, WORLD_A))?.state).toBe("ready");
  });

  it("does the same for a SPARQL update", async () => {
    const env = await midPass();
    // No Vectorize binding: the post-update orphan cleanup (which itself marks
    // a world stale and clears the cursor) is skipped, isolating the fix.
    const noVectors = { ...env, VECTORIZE_INDEX: undefined };
    expect((await update(noVectors)).status).toBe(200);
    expect((await getWorldState(env, WORLD_A))?.reindex_cursor).toBeNull();
  });

  it("leaves a pass alone when the world is live and embeds the import itself", async () => {
    const env = await midPass();
    await setWorldState(env, WORLD_A, "ready", MODEL, "s1");
    expect((await importTriple(env)).status).toBe(200);
    expect((await getWorldState(env, WORLD_A))?.reindex_cursor).toBe("s1");
  });
});
