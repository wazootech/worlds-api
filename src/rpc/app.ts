/**
 * HTTP server for the Worlds JSON-RPC API (`POST /rpc`).
 *
 * @module
 *
 * ## Running the server
 *
 * The workspace root `main.ts` [default-exports](https://docs.deno.com/runtime/reference/cli/serve/)
 * a `fetch` handler for **`deno serve`** (`deno task dev` wraps `deno serve --watch`).
 * {@link createRpcApp} builds the default app.
 *
 * ## Deployment and persistence
 *
 * {@link createRpcApp} defaults to a {@link Worlds}
 * instance backed by **in-memory** storage (single process; **data is lost on
 * restart**). For production, pass a {@link WorldsInterface} built with libSQL /
 * Turso — typically via `createWorldsWithLibsql()` from
 * `src/core/worlds-factory.ts`, or your own implementation.
 *
 * ```typescript
 * import { createRpcApp } from "#/rpc/mod.ts";
 * import { createWorldsWithLibsql } from "#/core/worlds-factory.ts";
 *
 * const app = createRpcApp({ worlds: createWorldsWithLibsql() });
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
 * {@link loadTransportConfigFromEnv}; pass {@link RpcAppOptions.transport} to override
 * programmatically (tests, embedding). **Authentication is not enforced here** — add
 * Hono middleware or enforce auth/TLS at your edge.
 */
import { Hono } from "@hono/hono";
import type { WorldsInterface } from "#/core/interfaces.ts";
import { Worlds } from "#/core/worlds.ts";
import { InMemoryWorldStorage } from "#/core/storage/in-memory.ts";
import { InMemoryQuadStorageManager } from "#/rdf/storage/in-memory-quad-storage-manager.ts";
import { handleRpc } from "./handler.ts";
import type { WorldsRpcRequest } from "#/rpc/openapi/generated/types.gen.ts";
import type { WorldsRpcError } from "#/rpc/openapi/generated/types.gen.ts";
import type { TransportConfig } from "./transport/types.ts";
import {
  loadTransportConfigFromEnv,
  mergeTransportConfig,
} from "./transport/env.ts";
import { applyTransportPreset } from "./transport/preset.ts";

export type { TransportConfig } from "./transport/types.ts";
export {
  loadTransportConfigFromEnv,
  mergeTransportConfig,
} from "./transport/env.ts";
export { applyTransportPreset } from "./transport/preset.ts";

/** Options for {@link createRpcApp}: worlds instance plus transport overrides. */
export type RpcAppOptions = {
  worlds?: WorldsInterface;
  transport?: Partial<TransportConfig>;
};

function createDefaultOptions(): RpcAppOptions {
  const worldStorage = new InMemoryWorldStorage();
  const quadStorageManager = new InMemoryQuadStorageManager();
  const worlds = new Worlds({ worldStorage, quadStorageManager });
  return { worlds };
}

function resolveRpcAppOptions(
  partial: RpcAppOptions,
): Required<Pick<RpcAppOptions, "worlds">> {
  const resolved = { ...createDefaultOptions(), ...partial };
  return resolved as Required<Pick<RpcAppOptions, "worlds">>;
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

function getHttpStatus(errorCode: string | undefined): number {
  switch (errorCode) {
    case "NOT_FOUND":
      return 404;
    case "ALREADY_EXISTS":
      return 409;
    case "INVALID_ARGUMENT":
      return 400;
    case "INTERNAL":
      return 500;
    default:
      return 400;
  }
}

/** Mounts `POST /rpc` JSON-RPC handling. Compose with {@link applyTransportPreset} as needed. */
export function mountRpcPost(app: Hono, worlds: WorldsInterface): void {
  app.post("/rpc", async (c) => {
    const req = (await c.req.json()) as WorldsRpcRequest;
    const result = await handleRpc(worlds, req);
    if ("error" in result) {
      const err = result as WorldsRpcError;
      const status = getHttpStatus(err.error.code);
      return c.json(err, status as any);
    }
    return c.json(result, 200);
  });
}

/**
 * Worlds HTTP API: `POST /rpc` with JSON body validated by
 * {@link ../rpc/handler.ts handleRpc}.
 *
 * Applies {@link applyTransportPreset}: CORS, bounded body size ({@code 413} when exceeded),
 * and in-process `/rpc` rate limiting ({@code 429} when exceeded). Configure via env (see
 * {@link loadTransportConfigFromEnv}) or {@link RpcAppOptions.transport}.
 *
 * Successful RPC returns HTTP **200**; RPC-level failures return an HTTP status matching
 * the error code category (e.g., **404** for {@code NOT_FOUND}, **409** for
 * {@code ALREADY_EXISTS}) with a JSON error envelope.
 *
 * **Auth** must be enforced out-of-band unless you compose additional middleware yourself.
 */
export function createRpcApp(options: RpcAppOptions = {}): Hono {
  const { transport: transportOverrides, ...rest } = options;
  const { worlds } = resolveRpcAppOptions(rest);
  const transport = transportOverrides
    ? mergeTransportConfig(loadTransportConfigFromEnv(), transportOverrides)
    : null;
  return createHonoRpcApp(worlds, transport);
}
