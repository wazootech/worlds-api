/**
 * HTTP server for the Worlds RPC API (`POST /rpc`).
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
 * const app = createRpcApp({ worldStorage: createWorldsWithLibsql().worldStorage, ... });
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
 * programmatically (tests, embedding). Auth is enforced via API keys (`X-Api-Key` header).
 */
import { Hono } from "@hono/hono";
import { Worlds } from "#/core/worlds.ts";
import { InMemoryWorldStorage } from "#/core/storage/in-memory.ts";
import { InMemoryQuadStorageManager } from "#/rdf/storage/in-memory/manager.ts";
import { InMemoryChunkIndexManager } from "#/indexing/storage/in-memory.ts";
import { FakeEmbeddingsService } from "#/indexing/embeddings/fake.ts";
import { handleRpc } from "./handler.ts";
import type { WorldsRpcRequest } from "#/rpc/openapi/generated/types.gen.ts";
import type { WorldsRpcError } from "#/rpc/openapi/generated/types.gen.ts";
import type { TransportConfig } from "./transport/types.ts";
import {
  loadTransportConfigFromEnv,
  mergeTransportConfig,
} from "./transport/env.ts";
import { applyTransportPreset } from "./transport/preset.ts";
import type { WorldStorage } from "#/core/storage/interface.ts";
import type { QuadStorageManager } from "#/rdf/storage/interface.ts";
import type { ApiKeyStorage } from "#/api-keys/api-key-storage.ts";
import { verifyApiKey } from "#/api-keys/api-key.ts";

export type { TransportConfig } from "./transport/types.ts";
export {
  loadTransportConfigFromEnv,
  mergeTransportConfig,
} from "./transport/env.ts";
export { applyTransportPreset } from "./transport/preset.ts";

/** Options for {@link createRpcApp}: storage/deps plus transport overrides. */
export type RpcAppOptions = {
  worldStorage?: WorldStorage;
  quadStorageManager?: QuadStorageManager;
  transport?: Partial<TransportConfig>;
  /** API key storage implementation */
  apiKeyStorage?: ApiKeyStorage;
};

function createDefaultOptions() {
  const worldStorage = new InMemoryWorldStorage();
  const quadStorageManager = new InMemoryQuadStorageManager();
  return { worldStorage, quadStorageManager };
}

function getHttpStatus(errorCode: string | undefined): number {
  switch (errorCode) {
    case "NOT_FOUND":
      return 404;
    case "ALREADY_EXISTS":
      return 409;
    case "INVALID_ARGUMENT":
      return 400;
    case "UNAUTHENTICATED":
      return 401;
    case "PERMISSION_DENIED":
      return 403;
    case "INTERNAL":
      return 500;
    default:
      return 400;
  }
}

/**
 * Creates a factory function that returns a Worlds instance scoped to a user.
 * This allows request-level auth scoping without changing WorldsInterface.
 */
function createWorldsFactory(
  worldStorage: WorldStorage,
  quadStorageManager: QuadStorageManager,
): (keyId: string | null, scopes: string[]) => Worlds {
  const searchDeps = {
    chunkIndexManager: new InMemoryChunkIndexManager(),
    embeddings: new FakeEmbeddingsService(),
  };

  return (keyId: string | null, scopes: string[]) => {
    return new Worlds(
      {
        worldStorage,
        quadStorageManager,
        chunkIndexManager: searchDeps.chunkIndexManager,
        embeddings: searchDeps.embeddings,
      },
      keyId,
      scopes,
    );
  };
}

/** Mounts `POST /rpc` Worlds RPC handling with auth. Compose with {@link applyTransportPreset} as needed. */
export function mountRpcPost(
  app: Hono,
  worldStorage: WorldStorage,
  quadStorageManager: QuadStorageManager,
  apiKeyStorage?: ApiKeyStorage,
): void {
  const worldsFactory = createWorldsFactory(worldStorage, quadStorageManager);

  app.post("/rpc", async (c) => {
    const apiKey = c.req.header("X-Api-Key");
    if (!apiKey) {
      return c.json(
        {
          action: "unknown",
          error: {
            code: "UNAUTHENTICATED",
            message: "Missing X-Api-Key header",
          },
        },
        401,
      );
    }

    let verified: { keyId: string; scopes: string[] };
    try {
      if (!apiKeyStorage) {
        throw new Error("API key storage not configured");
      }
      verified = await verifyApiKey(apiKey, apiKeyStorage);
    } catch (e) {
      return c.json(
        {
          action: "unknown",
          error: {
            code: "UNAUTHENTICATED",
            message: e instanceof Error ? e.message : "Invalid API key",
          },
        },
        401,
      );
    }

    const scopedWorlds = worldsFactory(verified.keyId, verified.scopes);
    const req = (await c.req.json()) as WorldsRpcRequest;
    const result = await handleRpc(scopedWorlds, req);
    if ("error" in result) {
      const err = result as WorldsRpcError;
      const status = getHttpStatus(err.error.code) as
        | 400
        | 401
        | 403
        | 404
        | 409
        | 500;
      return c.json(err, status);
    }
    return c.json(result, 200);
  });
}

function createHonoRpcApp(
  worldStorage: WorldStorage,
  quadStorageManager: QuadStorageManager,
  transport: TransportConfig | null,
  apiKeyStorage?: ApiKeyStorage,
): Hono {
  const app = new Hono();
  if (transport !== null) {
    applyTransportPreset(app, transport);
  }
  mountRpcPost(app, worldStorage, quadStorageManager, apiKeyStorage);
  return app;
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
 * {@code ALREADY_EXISTS}, **401** for {@code UNAUTHENTICATED}, **403** for {@code PERMISSION_DENIED})
 * with a JSON error envelope.
 *
 * Auth is enforced via `X-Api-Key` header on every request.
 */
export function createRpcApp(options: RpcAppOptions = {}): Hono {
  const { transport: transportOverrides, ...rest } = options;
  const { worldStorage, quadStorageManager } = createDefaultOptions();
  const finalWorldStorage = rest.worldStorage ?? worldStorage;
  const finalQuadStorageManager = rest.quadStorageManager ?? quadStorageManager;
  const transport = transportOverrides
    ? mergeTransportConfig(loadTransportConfigFromEnv(), transportOverrides)
    : null;
  const apiKeyStorage = options.apiKeyStorage;
  return createHonoRpcApp(
    finalWorldStorage,
    finalQuadStorageManager,
    transport,
    apiKeyStorage,
  );
}
