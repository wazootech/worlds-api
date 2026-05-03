/**
 * Reference HTTP server for the Worlds JSON-RPC API (`POST /rpc`).
 *
 * @module
 *
 * ## Running the server
 *
 * The workspace root `main.ts` imports {@link mainApp} and calls `Deno.serve`,
 * which uses {@link createMainApp} with its default options.
 *
 * ## Deployment and persistence
 *
 * {@link createMainApp} and {@link createRpcApp} default to a {@link Worlds}
 * instance backed by **in-memory** storage (single process; **data is lost on
 * restart**). For production, pass a {@link WorldsInterface} built with libSQL /
 * Turso — typically via `createWorldsWithLibsql()` from
 * `src/core/worlds-factory.ts`, or your own implementation.
 *
 * ```typescript
 * import { createMainApp } from "#/api/server/mod.ts";
 * import { createWorldsWithLibsql } from "#/core/worlds-factory.ts";
 *
 * Deno.serve((req) =>
 *   createMainApp({ worlds: createWorldsWithLibsql() }).fetch(req),
 * );
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
 * ## HTTP hardening
 *
 * {@link applyReferenceServingPreset} applies CORS, `/rpc` body size limits, and
 * rate limiting via **environment variables** (see its table). **Authentication is not
 * enforced here** — add Hono middleware or enforce auth/TLS at your edge.
 *
 * Env-first tuning matches typical **deployed** setups (Kubernetes, systemd, Fly,
 * Docker, etc.): configuration is injected per process without reading a repo file.
 * Secrets stay out of config files; flags would duplicate env in production. For fixed
 * local defaults, wrapper scripts can `export` vars before importing this module.
 * Embedding this library with hard-coded transport policy is supported by composing
 * your own Hono app and calling {@link mountRpcPost} (or cloning the preset logic).
 */
import { Hono } from "@hono/hono";
import type { Context } from "@hono/hono";
import { cors } from "@hono/hono/cors";
import { bodyLimit } from "@hono/hono/body-limit";
import { rateLimiter } from "@hono-rate-limiter/hono-rate-limiter";
import type { WorldsInterface } from "#/core/interfaces.ts";
import { Worlds } from "#/core/worlds.ts";
import { InMemoryWorldStorage } from "#/core/storage/in-memory.ts";
import { InMemoryQuadStorageManager } from "#/rdf/storage/in-memory-quad-storage-manager.ts";
import { handleRpc } from "#/api/rpc/handler.ts";
import type { WorldsRpcRequest } from "#/api/openapi/generated/types.gen.ts";
import type { WorldsRpcError } from "#/api/openapi/generated/types.gen.ts";

/** Default POST /rpc body cap (bytes). Override with `WORLDS_RPC_BODY_LIMIT_BYTES`. */
const DEFAULT_RPC_BODY_LIMIT_BYTES = 2 * 1024 * 1024;

export type ApiServerOptions = {
  worlds: WorldsInterface;
};

function createDefaultOptions(): ApiServerOptions {
  const worldStorage = new InMemoryWorldStorage();
  const quadStorageManager = new InMemoryQuadStorageManager();
  const worlds = new Worlds(worldStorage, quadStorageManager);
  return { worlds };
}

function resolveApiServerOptions(
  partial: Partial<ApiServerOptions>,
): ApiServerOptions {
  return { ...createDefaultOptions(), ...partial };
}

function createHonoRpcApp(worlds: WorldsInterface, preset: boolean): Hono {
  const app = new Hono();
  if (preset) {
    applyReferenceServingPreset(app);
  }
  mountRpcPost(app, worlds);
  return app;
}

function readBodyLimitBytes(): number {
  const raw = Deno.env.get("WORLDS_RPC_BODY_LIMIT_BYTES");
  if (!raw?.trim()) {
    return DEFAULT_RPC_BODY_LIMIT_BYTES;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RPC_BODY_LIMIT_BYTES;
}

function readCorsOrigin(): string | string[] {
  const raw = Deno.env.get("WORLDS_CORS_ORIGIN")?.trim();
  if (!raw) {
    return "*";
  }
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length === 1 ? parts[0]! : parts;
}

function readRateLimitWindowMs(): number {
  const raw = Deno.env.get("WORLDS_RATE_LIMIT_WINDOW_MS");
  const n = raw?.trim() ? Number(raw) : 60_000;
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

function readRateLimitMax(): number {
  const raw = Deno.env.get("WORLDS_RATE_LIMIT_MAX");
  const n = raw?.trim() ? Number(raw) : 2000;
  return Number.isFinite(n) && n > 0 ? n : 2000;
}

function rateLimitKey(c: Context): string {
  const cf = c.req.header("cf-connecting-ip")?.trim();
  if (cf) {
    return cf;
  }
  const fwd = c.req.header("x-forwarded-for");
  const firstHop = fwd?.split(",")[0]?.trim();
  if (firstHop) {
    return firstHop;
  }
  const realIp = c.req.header("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }
  return "anonymous";
}

/**
 * Applies the reference HTTP hardening chain to a Hono instance **before**
 * attaching `POST /rpc`.
 *
 * Order: **CORS** (global), **body-size cap** (`/rpc`, returns 413 when exceeded),
 * **rate limit** (`/rpc`). The default store is in-memory only (single process,
 * not durable across restart). Tune via env:
 *
 * | Variable | Purpose |
 * | --------- | --------- |
 * | `WORLDS_RPC_BODY_LIMIT_BYTES` | Max JSON body bytes for `/rpc` |
 * | `WORLDS_CORS_ORIGIN` | Comma-separated origins or omit for `*` |
 * | `WORLDS_RATE_LIMIT_WINDOW_MS` | Rate-limit window length |
 * | `WORLDS_RATE_LIMIT_MAX` | Max requests per window per key |
 *
 * **Auth is not enforced here** — add middleware or terminate TLS/auth at your edge as needed.
 *
 * Values are read from the environment **when middleware is wired** — not from a CLI or JSON
 * file — so deployments can inject tuning without rebuilding the artifact.
 */
export function applyReferenceServingPreset(app: Hono): void {
  app.use(
    "*",
    cors({
      origin: readCorsOrigin(),
      allowMethods: ["GET", "HEAD", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      exposeHeaders: [
        "RateLimit-Limit",
        "RateLimit-Remaining",
        "RateLimit-Reset",
      ],
      credentials: Boolean(
        Deno.env.get("WORLDS_CORS_ALLOW_CREDENTIALS") === "true",
      ),
    }),
  );

  app.use(
    "/rpc",
    bodyLimit({
      maxSize: readBodyLimitBytes(),
      onError: (c) => {
        return c.json({ message: "Request body exceeds limit." }, 413);
      },
    }),
  );

  app.use(
    "/rpc",
    rateLimiter({
      windowMs: readRateLimitWindowMs(),
      limit: readRateLimitMax(),
      standardHeaders: "draft-6",
      keyGenerator: (c) => rateLimitKey(c),
    }),
  );
}

/** Mounts `POST /rpc` JSON-RPC handling. Compose with {@link applyReferenceServingPreset} as needed. */
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
 * For custom stacks call {@link applyReferenceServingPreset} on an app instance
 * and mount RPC handling yourself via this module’s internals, or use
 * {@link createMainApp} for defaults.
 */
export function createRpcApp(options: Partial<ApiServerOptions> = {}) {
  const { worlds } = resolveApiServerOptions(options);
  return createHonoRpcApp(worlds, false);
}

/**
 * Standalone Worlds HTTP API: `POST /rpc` with JSON body validated by
 * {@link ../rpc/handler.ts handleRpc}.
 *
 * Successful RPC returns HTTP **200**; any RPC-level failure (including
 * {@code NOT_FOUND}) returns **400** with a JSON error envelope — clients must read
 * {@code error.code}, not HTTP status alone.
 *
 * **Auth** must be enforced out-of-band unless you compose additional middleware yourself.
 *
 * Applies {@link applyReferenceServingPreset}: CORS (configurable env), bounded body size
 * ({@code 413} when exceeded), and in-process `/rpc` rate limiting ({@code 429} when exceeded).
 */
export function createMainApp(options: Partial<ApiServerOptions> = {}) {
  const { worlds } = resolveApiServerOptions(options);
  return createHonoRpcApp(worlds, true);
}

export const mainApp = createMainApp();
