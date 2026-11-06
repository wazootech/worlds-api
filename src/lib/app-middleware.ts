import type {
  Context,
  ErrorHandler,
  MiddlewareHandler,
  NotFoundHandler,
} from "hono";
import type { Env } from "../env";
import { checkRateLimit, isOriginAllowed } from "./abuse";
import { sha256Hex } from "./crypto";
import { ensureControlPlaneSchema } from "./d1-schema";
import { flushWriteUsage } from "./write-budget";

type AppEnv = { Bindings: Env };

export function allowedOrigin(c: Context<{ Bindings: Env }>): string | null {
  const origin = c.req.header("Origin");
  return origin && isOriginAllowed(origin, c.env as unknown as Env)
    ? origin
    : null;
}

// Per-key token-bucket rate limiting (in-memory). Exempts health, readiness,
// and OpenAPI endpoints so probes and spec fetches are never throttled.
export const rateLimitMiddleware: MiddlewareHandler<AppEnv> = async (
  c,
  next,
) => {
  const path = new URL(c.req.url).pathname;
  if (path === "/health" || path === "/ready" || path === "/openapi.json") {
    return next();
  }

  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : "";
  const key = token ? await sha256Hex(token) : "anonymous";
  const decision = checkRateLimit(`key:${key}`, c.env as unknown as Env);
  if (!decision.allowed) {
    c.header("Retry-After", String(decision.retryAfterSeconds));
    return c.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: `Too many requests. Retry after ${decision.retryAfterSeconds} second(s).`,
        },
      },
      429,
    );
  }
  return next();
};

export const onAppError: ErrorHandler<AppEnv> = (err, c) => {
  console.error(err);
  const origin = allowedOrigin(c);
  if (origin) c.header("Access-Control-Allow-Origin", origin);
  c.header("Access-Control-Allow-Headers", "*");
  c.header("Access-Control-Allow-Methods", "*");
  const message = err instanceof Error ? err.message : String(err);
  if (
    err instanceof SyntaxError ||
    (typeof message === "string" &&
      (message.includes("Unexpected end of JSON") ||
        message.includes("Malformed JSON in request body")))
  ) {
    return c.json(
      {
        error: {
          code: "INVALID_ARGUMENT",
          message: "Invalid JSON body",
        },
      },
      400,
    );
  }
  return c.json(
    {
      error: {
        code: "INTERNAL",
        message: err instanceof Error ? err.message : "Internal server error",
      },
    },
    500,
  );
};

export const onNotFound: NotFoundHandler<AppEnv> = (c) => {
  const origin = allowedOrigin(c);
  if (origin) c.header("Access-Control-Allow-Origin", origin);
  return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
};

// Initialize control-plane DDL once per Worker isolate before application routes.
// /health remains a liveness probe; /ready also verifies the initialized schema.
let schemaInitialized = false;

export const schemaInitMiddleware: MiddlewareHandler<AppEnv> = async (
  c,
  next,
) => {
  const path = new URL(c.req.url).pathname;
  if (path === "/health" || path === "/openapi.json") return next();

  if (!schemaInitialized) {
    const db = (c.env as unknown as Env).DB;
    if (db && typeof db.exec === "function") {
      try {
        await ensureControlPlaneSchema(db);
        schemaInitialized = true;
      } catch (error) {
        if (path === "/ready") {
          return c.json(
            {
              status: "not_ready",
              error: error instanceof Error ? error.message : String(error),
            },
            503,
          );
        }
        throw error;
      }
    }
  }
  return next();
};

// Store the rows the data plane wrote during the request. A no-op when the
// write budget is off, since nothing is counted then.
export const flushUsageMiddleware: MiddlewareHandler<AppEnv> = async (
  c,
  next,
) => {
  await next();
  await flushWriteUsage(c.env as unknown as Env);
};
