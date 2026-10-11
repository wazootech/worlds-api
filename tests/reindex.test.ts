import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorldsSdkInterface } from "@worlds/sdk";
import app from "../src/app";
import {
  clearSdkCacheForWorld,
  getWorldSdk,
  resolveWorldDatabase,
} from "../src/lib/world-db";

const mocks = vi.hoisted(() => ({
  clearSdkCacheForWorld: vi.fn(),
  getWorldSdk: vi.fn(),
  resolveWorldDatabase: vi.fn(),
  reindex: vi.fn(),
}));

vi.mock("../src/lib/world-db", () => ({
  clearSdkCacheForWorld: mocks.clearSdkCacheForWorld,
  getWorldSdk: mocks.getWorldSdk,
  resolveWorldDatabase: mocks.resolveWorldDatabase,
}));

const worldId = "w_00000000-0000-4000-8000-000000000001";
const worldRef = {
  worldId,
  namespace: "health-test",
  embeddingModel: "use",
  chunkSize: 1000,
  topK: 5,
  minScore: 0.5,
};
const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const getWorldSdkMock = vi.mocked(getWorldSdk);
const resolveWorldDatabaseMock = vi.mocked(resolveWorldDatabase);
const clearSdkCacheForWorldMock = vi.mocked(clearSdkCacheForWorld);

beforeEach(() => {
  vi.clearAllMocks();
  resolveWorldDatabaseMock.mockResolvedValue(worldRef);
  getWorldSdkMock.mockResolvedValue({
    reindex: mocks.reindex,
  } as unknown as WorldsSdkInterface);
  mocks.reindex.mockResolvedValue({ processedQuadCount: 7, chunkRowCount: 3 });
});

describe("POST /worlds/:worldId/reindex endpoint", () => {
  it("rejects request without authorization token", async () => {
    const res = await app.request(
      `/worlds/${worldId}/reindex`,
      { method: "POST" },
      {},
      executionCtx,
    );
    expect(res.status).toBe(401);
    expect(getWorldSdkMock).not.toHaveBeenCalled();
  });

  it("runs the SDK reindex before reporting completion and clears its cache", async () => {
    const res = await app.request(
      `/worlds/${worldId}/reindex`,
      {
        method: "POST",
        headers: { Authorization: "Bearer admin-token" },
      },
      { WORLDS_API_ADMIN_KEY: "admin-token" },
      executionCtx,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      status: "completed",
      processedQuadCount: 7,
      chunkRowCount: 3,
    });
    expect(mocks.reindex).toHaveBeenCalledOnce();
    expect(clearSdkCacheForWorldMock).toHaveBeenCalledWith(worldId);
  });

  it("fails closed when the configured SDK does not implement reindex", async () => {
    getWorldSdkMock.mockResolvedValueOnce({} as unknown as WorldsSdkInterface);

    const res = await app.request(
      `/worlds/${worldId}/reindex`,
      {
        method: "POST",
        headers: { Authorization: "Bearer admin-token" },
      },
      { WORLDS_API_ADMIN_KEY: "admin-token" },
      executionCtx,
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "INTERNAL",
        message: "Configured Worlds SDK does not support reindexing",
      },
    });
    expect(mocks.reindex).not.toHaveBeenCalled();
    expect(clearSdkCacheForWorldMock).toHaveBeenCalledWith(worldId);
  });

  it("returns an error instead of claiming success when reindex fails", async () => {
    mocks.reindex.mockRejectedValueOnce(new Error("index build failed"));

    const res = await app.request(
      `/worlds/${worldId}/reindex`,
      {
        method: "POST",
        headers: { Authorization: "Bearer admin-token" },
      },
      { WORLDS_API_ADMIN_KEY: "admin-token" },
      executionCtx,
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: { code: "INTERNAL", message: "index build failed" },
    });
    expect(mocks.reindex).toHaveBeenCalledOnce();
    expect(clearSdkCacheForWorldMock).toHaveBeenCalledWith(worldId);
  });
});

describe("reindex vector sync status (worlds-cloudflare#40)", () => {
  const vectorSync = {
    enabled: true,
    attempted: 3,
    upserted: 3,
    failedUpserts: 0,
    embeddingFailures: 0,
    staleDeleteFailures: 0,
    errors: [],
  };
  const reindexWith = async (report: unknown) => {
    mocks.reindex.mockResolvedValue(report);
    const res = await app.request(
      `/worlds/${worldId}/reindex`,
      {
        method: "POST",
        headers: { Authorization: "Bearer test-admin-key" },
      },
      { WORLDS_API_ADMIN_KEY: "test-admin-key" },
      executionCtx,
    );
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, unknown>;
  };

  it("reports completed with the vector sync report when nothing failed", async () => {
    const body = await reindexWith({
      processedQuadCount: 7,
      chunkRowCount: 3,
      vectorSync,
    });
    expect(body).toEqual({
      ok: true,
      status: "completed",
      processedQuadCount: 7,
      chunkRowCount: 3,
      vectorSync,
    });
  });

  for (const failure of [
    { failedUpserts: 3, upserted: 0 },
    { embeddingFailures: 2 },
    { staleDeleteFailures: 1 },
  ]) {
    it(`reports completed_with_vector_errors for ${Object.keys(failure)[0]}`, async () => {
      const body = await reindexWith({
        processedQuadCount: 7,
        chunkRowCount: 3,
        vectorSync: {
          ...vectorSync,
          ...failure,
          errors: ["upsert: vectorize 503"],
        },
      });
      expect(body.ok).toBe(true);
      expect(body.status).toBe("completed_with_vector_errors");
      expect((body.vectorSync as { errors: string[] }).errors).toEqual([
        "upsert: vectorize 503",
      ]);
    });
  }

  it("omits vectorSync and reports completed when the SDK does not report it", async () => {
    const body = await reindexWith({ processedQuadCount: 7, chunkRowCount: 3 });
    expect(body).toEqual({
      ok: true,
      status: "completed",
      processedQuadCount: 7,
      chunkRowCount: 3,
    });
  });
});
