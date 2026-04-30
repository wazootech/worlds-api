import { Hono } from "jsr:@hono/hono@^4.7.0";
import type { WorldsInterface } from "#/core/interfaces.ts";
import { Worlds } from "#/core/worlds.ts";
import { InMemoryWorldStorage } from "#/core/storage/in-memory.ts";
import { InMemoryFactStorageManager } from "#/facts/storage/in-memory-fact-storage-manager.ts";
import { handleRpc } from "#/api/rpc/handler.ts";
import type { WorldsRpcRequest } from "#/api/openapi/generated/types.gen.ts";
import type { WorldsRpcError } from "#/api/openapi/generated/types.gen.ts";

export type ApiServerDeps = {
  worlds: WorldsInterface;
};

function createDefaultDeps(): ApiServerDeps {
  const worldStorage = new InMemoryWorldStorage();
  const factStorageManager = new InMemoryFactStorageManager();
  const worlds = new Worlds(worldStorage, factStorageManager);
  return { worlds };
}

/**
 * Constructs the main Hono app for the API server.
 *
 * - Mounts `POST /rpc` for the generated Worlds RPC transport.
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
