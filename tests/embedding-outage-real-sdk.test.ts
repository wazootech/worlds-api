import { describe, expect, it, vi } from "vitest";
import { getWorldState } from "@/lib/embeddings/store";
import {
  chunkRows,
  fetchMock,
  http,
  importTurtle,
  KEPT,
  makeEnv,
  REMOVED,
  seedReadyWorld,
  sparql,
  useCleanupHarness,
  WORLD_A,
} from "./helpers/byok-cleanup-harness";

// Runs the real @worlds/cloudflare engine (see byok-vector-cleanup.test.ts for
// why it is loaded by path) against a failing embedding provider. Since
// @worlds/cloudflare 0.15 an embedding failure throws on commit and reindex
// with nothing written, and the routes answer it with a typed 502.
vi.mock(
  "@worlds/cloudflare",
  async () => await import("../node_modules/@worlds/cloudflare/src/mod.js"),
);
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

useCleanupHarness();

const NEW_TEXT = "Wombats produce cube shaped droppings";

function failProvider() {
  // 400 is not retried, so the outage surfaces immediately as bad_request.
  fetchMock.mockImplementation(async () => new Response("{}", { status: 400 }));
}

async function expectEmbeddingFailed(res: Response) {
  expect(res.status).toBe(502);
  const body = (await res.json()) as any;
  expect(body.error.code).toBe("EMBEDDING_FAILED");
  expect(body.error.reason).toBe("bad_request");
}

describe("embedding outage against the real @worlds/cloudflare", () => {
  it("import answers 502, writes nothing, keeps the world ready", async () => {
    const env = makeEnv();
    await seedReadyWorld(env);
    failProvider();

    const res = await http(env, "w-token", `/worlds/${WORLD_A}/import`, {
      method: "POST",
      body: JSON.stringify({
        data: `<urn:s:new> <http://schema.org/description> "${NEW_TEXT}" .`,
      }),
    });
    await expectEmbeddingFailed(res);
    expect(
      chunkRows(WORLD_A)
        .map((r) => r.value)
        .sort(),
    ).toEqual([KEPT, REMOVED].sort());
    expect((await getWorldState(env, WORLD_A))?.state).toBe("ready");
  });

  it("SPARQL update answers 502, writes nothing, keeps the world ready", async () => {
    const env = makeEnv();
    await seedReadyWorld(env);
    failProvider();

    const res = await sparql(
      env,
      WORLD_A,
      `INSERT DATA { <urn:s:new> <http://schema.org/description> "${NEW_TEXT}" }`,
    );
    await expectEmbeddingFailed(res);
    expect(chunkRows(WORLD_A)).toHaveLength(2);
    expect((await getWorldState(env, WORLD_A))?.state).toBe("ready");
  });

  it("reindex answers 502 and never leaves the world ready", async () => {
    const env = makeEnv();
    await seedReadyWorld(env);
    failProvider();

    const res = await http(env, "w-token", `/worlds/${WORLD_A}/reindex`, {
      method: "POST",
    });
    await expectEmbeddingFailed(res);
    expect((await getWorldState(env, WORLD_A))?.state).not.toBe("ready");
  });

  it("recovers: once the provider is back the same import succeeds", async () => {
    const env = makeEnv();
    await seedReadyWorld(env);
    failProvider();
    expect((await importTurtle(env, WORLD_A, NEW_TEXT)).status).toBe(502);

    fetchMock.mockImplementation(async (_url: string, init: any) => {
      const inputs = JSON.parse(init.body).input as string[];
      return new Response(
        JSON.stringify({
          data: inputs.map((_, index) => ({
            index,
            embedding: new Array(1536).fill(0.01),
          })),
        }),
        { status: 200 },
      );
    });
    expect((await importTurtle(env, WORLD_A, NEW_TEXT)).status).toBe(200);
    expect(chunkRows(WORLD_A).some((r) => r.value === NEW_TEXT)).toBe(true);
    expect((await getWorldState(env, WORLD_A))?.state).toBe("ready");
  });
});
