/**
 * HTTP server for the Worlds JSON-RPC API (`POST /rpc`).
 *
 * @module
 *
 * ## Running the server
 *
 * The workspace root `main.ts` [default-exports](https://docs.deno.com/runtime/reference/cli/serve/)
 * a `fetch` handler for **`deno serve`** (`deno task dev` wraps `deno serve --watch`).
 * {@link createRpcServer} builds the default {@link rpcServer}.
 *
 * ## Deployment and persistence
 *
 * {@link createRpcServer} and {@link createRpcApp} default to a {@link Worlds}
 * instance backed by **in-memory** storage (single process; **data is lost on
 * restart**). For production, pass a {@link WorldsInterface} built with libSQL /
 * Turso — typically via `createWorldsWithLibsql()` from
 * `src/core/worlds-factory.ts`, or your own implementation.
 *
 * ```typescript
 * import { createRpcServer } from "#/api/server/mod.ts";
 * import { createWorldsWithLibsql } from "#/core/worlds-factory.ts";
 *
 * const app = createRpcServer({ worlds: createWorldsWithLibsql() });
 * export default {
 *   fetch: (req: Request) => app.fetch(req),
 * } satisfies Deno.ServeDefaultExport;
 * ```
 *
 * ### Database client (`@libsql/client`)
 *
 * Persistent storage in this repo uses **`@libsql/client`** (`createClient`,
 * `Client`, `execute`) end-to-end so world, quad, and chunk layers share one
 * client type. Configure with **`LIBSQL_URL`** and **`LIBSQL_AUTH_TOKEN`**, or pass
 * `url` / `authToken` / `client` into `createWorldsWithLibsql` (see
 * `src/core/storage/libsql-client.ts`). Turso also documents
 * **`@tursodatabase/serverless/compat`** for fetch-only remote access; this codebase
 * intentionally standardizes on **`@libsql/client`** unless you introduce an adapter.
 *
 * ## Transport (HTTP edge)
 *
 * {@link applyTransportPreset} applies CORS, `/rpc` body limits, and rate limiting from a
 * {@link TransportConfig}. Production defaults load from the environment via
 * {@link loadTransportConfigFromEnv}; pass {@link MainAppOptions.transport} to override
 * programmatically (tests, embedding). **Authentication is not enforced here** — add
 * Hono middleware or enforce auth/TLS at your edge.
 */
import { Hono } from "@hono/hono";
import type { WorldsInterface } from "#/core/interfaces.ts";
import { Worlds } from "#/core/worlds.ts";
import { InMemoryWorldStorage } from "#/core/storage/in-memory.ts";
import { InMemoryQuadStorageManager } from "#/rdf/storage/in-memory-quad-storage-manager.ts";
import { handleRpc } from "#/api/rpc/handler.ts";
import type { WorldsRpcRequest } from "#/api/openapi/generated/types.gen.ts";
import type { WorldsRpcError } from "#/api/openapi/generated/types.gen.ts";
import type { TransportConfig } from "#/api/server/transport/types.ts";
import {
  loadTransportConfigFromEnv,
  mergeTransportConfig,
} from "#/api/server/transport/env.ts";
import { applyTransportPreset } from "#/api/server/transport/preset.ts";

export type { TransportConfig } from "#/api/server/transport/types.ts";
export {
  loadTransportConfigFromEnv,
  mergeTransportConfig,
} from "#/api/server/transport/env.ts";
export { applyTransportPreset } from "#/api/server/transport/preset.ts";

/** Dependency injection for the API server: the Worlds instance backing `POST /rpc`. */
export interface ApiServerOptions {
  worlds: WorldsInterface;
}

/** Options for {@link createMainApp}: optional `worlds` plus transport overrides. */
export type MainAppOptions = Partial<ApiServerOptions> & {
  transport?: Partial<TransportConfig>;
};

function createDefaultOptions(): ApiServerOptions {
  const worldStorage = new InMemoryWorldStorage();
  const quadStorageManager = new InMemoryQuadStorageManager();
  const worlds = new Worlds({ worldStorage, quadStorageManager });
  return { worlds };
}

function resolveApiServerOptions(
  partial: Partial<ApiServerOptions>,
): ApiServerOptions {
  return { ...createDefaultOptions(), ...partial };
}

function createHonoRpcApp(
  worlds: WorldsInterface,
  transport: TransportConfig | null,
): Hono {
  const app = new Hono();
  if (transport !== null) {
    applyTransportPreset(app, transport);
  }
  mountRpcPost(app, worlds);
  return app;
}

/** Mounts `POST /rpc` JSON-RPC handling. Compose with {@link applyTransportPreset} as needed. */
export function mountRpcPost(app: Hono, worlds: WorldsInterface): void {
  app.post("/rpc", async (c) => {
    const req = (await c.req.json()) as WorldsRpcRequest;
    const result = await handleRpc(worlds, req);
    if ("error" in result) {
      return c.json(result as WorldsRpcError, 400);
    }
    return c.json(result, 200);
  });
}

/**
 * Minimal Hono app: **only** `POST /rpc` (no CORS, body cap, or rate limiting).
 * For custom stacks call {@link applyTransportPreset} with a {@link TransportConfig},
 * then {@link mountRpcPost}, or use {@link createMainApp} for defaults.
 */
export function createRpcApp(options: Partial<ApiServerOptions> = {}) {
  const { worlds } = resolveApiServerOptions(options);
  return createHonoRpcApp(worlds, null);
}

/**
 * Worlds HTTP API: `POST /rpc` with JSON body validated by
 * {@link ../rpc/handler.ts handleRpc}.
 *
 * Successful RPC returns HTTP **200**; any RPC-level failure (including
 * {@code NOT_FOUND}) returns **400** with a JSON error envelope — clients must read
 * {@code error.code}, not HTTP status alone.
 *
 * **Auth** must be enforced out-of-band unless you compose additional middleware yourself.
 *
 * Applies {@link applyTransportPreset}: CORS, bounded body size ({@code 413} when exceeded),
 * and in-process `/rpc` rate limiting ({@code 429} when exceeded). Configure via env (see
 * {@link loadTransportConfigFromEnv}) or {@link MainAppOptions.transport}.
 */
export function createRpcServer(options: MainAppOptions = {}) {
  const { transport: transportOverrides, ...rest } = options;
  const { worlds } = resolveApiServerOptions(rest);
  const transport = mergeTransportConfig(
    loadTransportConfigFromEnv(),
    transportOverrides,
  );
  return createHonoRpcApp(worlds, transport);
}

export const rpcServer = createRpcServer();
