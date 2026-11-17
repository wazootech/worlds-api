import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { provisionWorld } from "../src/lib/d1-provision";
import { registerCreateWorld } from "../src/routes/worlds/handlers-create";
import { readJson, type ErrorBody } from "./helpers/json";

vi.mock("../src/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/auth")>()),
  authorize: vi.fn().mockResolvedValue({
    admin: false,
    namespace: "test-namespace",
    scopes: ["data:write"],
  }),
}));

vi.mock("../src/lib/d1-provision", () => ({ provisionWorld: vi.fn() }));
vi.mock("../src/lib/embeddings/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/embeddings/store")>()),
  loadEmbeddingStatuses: vi.fn().mockResolvedValue(new Map()),
}));

const app = new OpenAPIHono<{ Bindings: Env }>();
registerCreateWorld(app);

function create(body: unknown) {
  return app.request("/worlds", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(provisionWorld).mockImplementation(
    async (_env, worldId, namespace, options) => ({
      world_id: worldId,
      namespace,
      display_name: options?.displayName ?? worldId,
      state: "active",
      embedding_model: "tfjs-universal-sentence-encoder",
      chunk_size: 1000,
      top_k: 20,
      min_score: 0,
      delete_time: null,
      expire_time: null,
      purge_status: "none",
      purged_at: null,
      create_time: "2026-01-01T00:00:00.000Z",
      update_time: "2026-01-01T00:00:00.000Z",
    }),
  );
});

describe("POST /worlds request shape", () => {
  it.each([
    { world: { displayName: "hello", region: "auto" } },
    { displayName: "hello", region: "auto" },
    { displayNmae: "hello" },
  ])("rejects unknown keys before provisioning: %j", async (body) => {
    const res = await create(body);
    expect(res.status).toBe(400);
    const error = (await readJson<ErrorBody>(res)).error;
    expect(error.code).toBe("INVALID_ARGUMENT");
    expect(error.message).toContain('Unrecognized key: "');
    expect(error.message).toContain('{"displayName":"hello"}');
    expect(provisionWorld).not.toHaveBeenCalled();
  });

  it.each([{}, { displayName: "hello" }])(
    "preserves valid flat requests: %j",
    async (body) => {
      const res = await create(body);
      expect(res.status).toBe(201);
      const world = await readJson<{ id: string; displayName: string }>(res);
      expect(world.displayName).toBe(body.displayName ?? world.id);
      expect(provisionWorld).toHaveBeenCalledOnce();
    },
  );
});
