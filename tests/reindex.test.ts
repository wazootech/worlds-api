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
