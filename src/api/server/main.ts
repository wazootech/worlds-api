import { Hono } from "jsr:@hono/hono@^4.7.0";
import type { WorldsInterface } from "#/core/interfaces.ts";
import { Worlds } from "#/core/worlds.ts";
import { InMemoryWorldStorage } from "#/core/storage/in-memory.ts";
import { InMemoryQuadStorageManager } from "#/rdf/storage/in-memory-quad-storage-manager.ts";
import { handleRpc } from "#/api/rpc/handler.ts";
import type { WorldsRpcRequest } from "#/api/openapi/generated/types.gen.ts";
import type { WorldsRpcError } from "#/api/openapi/generated/types.gen.ts";

export type ApiServerDeps = {
  worlds: WorldsInterface;
};

function createDefaultDeps(): ApiServerDeps {
  const worldStorage = new InMemoryWorldStorage();
  const quadStorageManager = new InMemoryQuadStorageManager();
  const worlds = new Worlds(worldStorage, quadStorageManager);
  return { worlds };
}

/**
 * Reference HTTP API: **single route** `POST /rpc`, JSON body validated by
 * {@link ../rpc/handler.ts handleRpc}.
 *
 * Successful RPC returns HTTP **200**; any RPC-level failure (including
 * `NOT_FOUND`) returns **400** with a JSON error envelope — clients must read
 * `error.code`. No auth, CORS, rate limits, or body-size caps (add at deploy time).
 */
export function createMainApp(deps: Partial<ApiServerDeps> = {}) {
  const { worlds } = { ...createDefaultDeps(), ...deps };

  const app = new Hono();

  app.post("/rpc", async (c) => {
    const req = (await c.req.json()) as WorldsRpcRequest;
    const result = await handleRpc(worlds, req);
    if ("error" in result) {
      return c.json(result as WorldsRpcError, 400);
    }
    return c.json(result, 200);
  });

  return app;
}

export const mainApp = createMainApp();
