import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import { resolveWorldDatabase } from "../src/lib/world-db";

const mocks = vi.hoisted(() => ({
  backfillInference: vi.fn(),
  resolveWorldDatabase: vi.fn(),
}));

vi.mock("@worlds/cloudflare", () => ({
  backfillInference: mocks.backfillInference,
}));
vi.mock("../src/lib/world-db", () => ({
  clearSdkCacheForWorld: vi.fn(),
  getWorldSdk: vi.fn(),
  resolveWorldDatabase: mocks.resolveWorldDatabase,
}));

const worldId = "w_00000000000000000000000001";
const ref = {
  worldId,
  namespace: "ns1",
  embeddingModel: "use",
  chunkSize: 1000,
  topK: 5,
  minScore: 0.5,
};
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;
const env = { WORLDS_API_ADMIN_KEY: "admin-token", DB: {} };
const post = () =>
  app.request(
    `/worlds/${worldId}/infer`,
    { method: "POST", headers: { Authorization: "Bearer admin-token" } },
    env,
    ctx,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveWorldDatabase).mockResolvedValue({
    ...ref,
    inference: { enabled: true, maxAssertedQuads: 500 },
  });
  mocks.backfillInference.mockResolvedValue({
    assertedQuads: 4,
    derivedWritten: 6,
    derivedRemoved: 2,
    inconsistencies: [{ rule: "x" }],
  });
});

describe("POST /worlds/:worldId/infer", () => {
  it("rejects a request without a token", async () => {
    const res = await app.request(
      `/worlds/${worldId}/infer`,
      { method: "POST" },
      env,
      ctx,
    );
    expect(res.status).toBe(401);
    expect(mocks.backfillInference).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown world", async () => {
    vi.mocked(resolveWorldDatabase).mockResolvedValue(null);
    expect((await post()).status).toBe(404);
  });

  it("refuses a world that has not enabled inference", async () => {
    vi.mocked(resolveWorldDatabase).mockResolvedValue(ref);
    const res = await post();
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe(
      "INFERENCE_NOT_ENABLED",
    );
    expect(mocks.backfillInference).not.toHaveBeenCalled();
  });

  it("back-fills with the world's settings and reports counts", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      assertedQuads: 4,
      derivedWritten: 6,
      derivedRemoved: 2,
      inconsistencyCount: 1,
    });
    expect(mocks.backfillInference).toHaveBeenCalledWith({
      database: env.DB,
      worldId,
      inference: { enabled: true, maxAssertedQuads: 500 },
    });
  });

  it("maps the size guard to 422 and a missing derived column to 409", async () => {
    const guard = Object.assign(new Error("too big"), {
      name: "InferenceSizeGuardError",
    });
    mocks.backfillInference.mockRejectedValueOnce(guard);
    const tooBig = await post();
    expect(tooBig.status).toBe(422);
    expect(((await tooBig.json()) as any).error.code).toBe(
      "INFERENCE_SIZE_GUARD",
    );

    mocks.backfillInference.mockRejectedValueOnce(
      new Error("quads: missing column derived"),
    );
    const noColumn = await post();
    expect(noColumn.status).toBe(409);
    expect(((await noColumn.json()) as any).error.code).toBe(
      "INFERENCE_UNAVAILABLE",
    );
  });
});
