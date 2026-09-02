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
  worldUid: "test-world",
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
      worldUid: "test-world",
      candidateCount: 40,
      vectorize: env.VECTORIZE_INDEX,
    });
  });

  it("does not pass vectorize when the binding is absent", async () => {
    const noVectorEnv = { ...env, VECTORIZE_INDEX: undefined };
    await getWorldSdk(noVectorEnv, worldRef);

    expect(createSdkMock).toHaveBeenCalledWith({
      database: noVectorEnv.DB,
      worldUid: "test-world",
    });
  });

  it("omits candidateCount for non-search callers", async () => {
    await getWorldSdk(env, worldRef);

    expect(createSdkMock).toHaveBeenCalledWith({
      database: env.DB,
      worldUid: "test-world",
      vectorize: env.VECTORIZE_INDEX,
    });
  });

  it("fails loudly when an embedding provider is configured but unimplemented", async () => {
    const configuredEnv = { ...env, EMBEDDING_PROVIDER: "workers-ai" };
    await expect(getWorldSdk(configuredEnv, worldRef)).rejects.toThrow(
      /EMBEDDING_PROVIDER/,
    );
    expect(createSdkMock).not.toHaveBeenCalled();
  });

  it("clearSdkCacheForWorld evicts only that world's SDK instances", async () => {
    await getWorldSdk(env, worldRef, 20);
    await getWorldSdk(env, worldRef, 40);
    const otherRef = { ...worldRef, worldUid: "other-world" };
    await getWorldSdk(env, otherRef);
    createSdkMock.mockClear();

    clearSdkCacheForWorld("test-world");
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
    const result = await resolveWorldDatabase(envWithDb, "nope");
    expect(result).toBeNull();
    expect(queryOneMock).toHaveBeenCalledWith(
      db,
      expect.stringContaining("WHERE uid = ? AND state = 'active'"),
      ["nope"],
    );
  });
});
