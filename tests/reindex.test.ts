import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import {
  clearSdkCacheForWorld,
  getWorldSdk,
  resolveWorldDatabase,
} from "../src/lib/world-db";

vi.mock("../src/lib/world-db", () => ({
  clearSdkCache: vi.fn(),
  clearSdkCacheForWorld: vi.fn(),
  getWorldSdk: vi.fn(),
  resolveWorldDatabase: vi.fn(),
}));

const worldId = "w_00000000-0000-4000-8000-000000000001";
const ref = {
  worldId,
  namespace: "user-1",
  embeddingModel: "use",
  chunkSize: 1000,
  topK: 5,
  minScore: 0.5,
};
const reindex = vi.fn();
const env = { WORLDS_ADMIN_KEY: "admin-key", DB: {} } as any;
const executionCtx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
} as any;

function adminRequest() {
  return app.request(
    `/worlds/${worldId}/reindex`,
    {
      method: "POST",
      headers: { authorization: "Bearer admin-key" },
    },
    env,
    executionCtx,
  );
}

describe("POST /worlds/:worldId/reindex endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorldDatabase).mockResolvedValue(ref);
    reindex.mockResolvedValue({ processedQuadCount: 1, chunkRowCount: 1 });
    vi.mocked(getWorldSdk).mockResolvedValue({ reindex } as never);
  });

  it("rejects request without authorization token", async () => {
    const response = await app.request(
      `/worlds/${worldId}/reindex`,
      { method: "POST" },
      env,
      executionCtx,
    );

    expect(response.status).toBe(401);
    expect(reindex).not.toHaveBeenCalled();
  });

  it("rebuilds the search index and evicts the cached SDK", async () => {
    const response = await adminRequest();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "completed" });
    expect(reindex).toHaveBeenCalledOnce();
    expect(clearSdkCacheForWorld).toHaveBeenCalledWith(worldId);
  });

  it("evicts the cached SDK and returns an error when rebuilding fails", async () => {
    reindex.mockRejectedValue(new Error("reindex failed"));
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await adminRequest();

    expect(response.status).toBe(500);
    expect(clearSdkCacheForWorld).toHaveBeenCalledWith(worldId);
    logger.mockRestore();
  });
});
