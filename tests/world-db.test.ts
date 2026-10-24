import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCloudflareWorldsSdk } from "@worlds/cloudflare";
import {
  clearSdkCache,
  clearSdkCacheForWorld,
  getWorldSdk,
  resolveWorldDatabase,
} from "../src/lib/world-db";

vi.mock("@worlds/cloudflare", () => ({
  createCloudflareWorldsSdk: vi.fn(),
}));

const createSdkMock = vi.mocked(createCloudflareWorldsSdk);

const env = {
  DB: { prepare: vi.fn() } as any,
  VECTORIZE_INDEX: {
    query: vi.fn(),
    upsert: vi.fn(),
    deleteByIds: vi.fn(),
  } as any,
} as any;

const worldRef = {
  worldId: "w_00000000000000000000000001",
  namespace: "ns",
  embeddingModel: "use",
  chunkSize: 1000,
  topK: 5,
  minScore: 0.5,
};

describe("getWorldSdk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSdkCache();
    createSdkMock.mockResolvedValue({} as never);
  });

  it("threads the Vectorize binding and candidateCount into the SDK factory", async () => {
    await getWorldSdk(env, worldRef, 40);

    expect(createSdkMock).toHaveBeenCalledWith({
      database: env.DB,
      worldId: "w_00000000000000000000000001",
      candidateCount: 40,
      vectorize: env.VECTORIZE_INDEX,
    });
  });

  it("passes inference only for a world that opted in", async () => {
    await getWorldSdk(env, worldRef);
    expect(createSdkMock.mock.calls[0]![0]).not.toHaveProperty("inference");

    clearSdkCache();
    createSdkMock.mockClear();
    await getWorldSdk(env, { ...worldRef, inference: { enabled: false } });
    expect(createSdkMock.mock.calls[0]![0]).not.toHaveProperty("inference");

    clearSdkCache();
    createSdkMock.mockClear();
    const inference = {
      enabled: true,
      graphs: "union" as const,
      maxAssertedQuads: 50,
    };
    await getWorldSdk(env, { ...worldRef, inference });
    expect(createSdkMock.mock.calls[0]![0]).toMatchObject({ inference });
  });

  it("does not pass vectorize when the binding is absent", async () => {
    const noVectorEnv = { ...env, VECTORIZE_INDEX: undefined };
    await getWorldSdk(noVectorEnv, worldRef);

    expect(createSdkMock).toHaveBeenCalledWith({
      database: noVectorEnv.DB,
      worldId: "w_00000000000000000000000001",
    });
  });

  it("omits candidateCount for non-search callers", async () => {
    await getWorldSdk(env, worldRef);

    expect(createSdkMock).toHaveBeenCalledWith({
      database: env.DB,
      worldId: "w_00000000000000000000000001",
      vectorize: env.VECTORIZE_INDEX,
    });
  });

  it("stays keyword-only (no throw) without a KEK or credential", async () => {
    await expect(getWorldSdk(env, worldRef)).resolves.toBeDefined();
    expect(createSdkMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ embeddingService: expect.anything() }),
    );
  });

  it("clearSdkCacheForWorld evicts only that world's SDK instances", async () => {
    await getWorldSdk(env, worldRef, 20);
    await getWorldSdk(env, worldRef, 40);
    const otherRef = {
      ...worldRef,
      worldId: "w_00000000000000000000000002",
    };
    await getWorldSdk(env, otherRef);
    createSdkMock.mockClear();

    clearSdkCacheForWorld("w_00000000000000000000000001");
    await getWorldSdk(env, worldRef, 20);
    await getWorldSdk(env, worldRef, 40);
    // Other world's SDK is still cached.
    await getWorldSdk(env, otherRef);

    expect(createSdkMock).toHaveBeenCalledTimes(2);
  });
});

describe("resolveWorldDatabase", () => {
  it("returns null for unknown or inactive worlds", async () => {
    const queryOneMock = vi.fn().mockResolvedValue(null);
    const db = { prepare: vi.fn() } as any;
    const envWithDb = { DB: db } as any;
    vi.spyOn(await import("../src/lib/db"), "queryOne").mockImplementation(
      queryOneMock,
    );
    const result = await resolveWorldDatabase(
      envWithDb,
      "w_00000000000000000000000003",
    );
    expect(result).toBeNull();
    expect(queryOneMock).toHaveBeenCalledWith(
      db,
      expect.stringContaining("WHERE w.world_id = ? AND w.state = 'active'"),
      ["w_00000000000000000000000003"],
    );
  });

  it("maps the joined inference columns onto the ref", async () => {
    const row = {
      world_id: "w_00000000000000000000000003",
      namespace: "ns",
      embedding_model: "m",
      chunk_size: 1,
      top_k: 2,
      min_score: 0,
    };
    const spy = vi.spyOn(await import("../src/lib/db"), "queryOne");
    spy.mockResolvedValueOnce({
      ...row,
      inference_enabled: 1,
      inference_graphs: "per-graph",
      inference_max_asserted_quads: 9,
    });
    expect(
      (await resolveWorldDatabase({ DB: {} } as any, row.world_id))?.inference,
    ).toEqual({ enabled: true, graphs: "per-graph", maxAssertedQuads: 9 });

    spy.mockResolvedValueOnce({
      ...row,
      inference_enabled: null,
      inference_graphs: null,
      inference_max_asserted_quads: null,
    });
    expect(
      (await resolveWorldDatabase({ DB: {} } as any, row.world_id))?.inference,
    ).toBeUndefined();
  });
});
