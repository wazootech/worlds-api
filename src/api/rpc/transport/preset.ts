import { Hono } from "@hono/hono";
import type { Context } from "@hono/hono";
import { cors } from "@hono/hono/cors";
import { bodyLimit } from "@hono/hono/body-limit";
import { rateLimiter } from "@hono-rate-limiter/hono-rate-limiter";
import type { TransportConfig } from "./types.ts";

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
 * Applies CORS, `/rpc` JSON body size limits, and `/rpc` rate limiting using an explicit
 * {@link TransportConfig} (typically from `loadTransportConfigFromEnv` in `./env.ts`).
 *
 * Order: **CORS** (global), **body-size cap** on `/rpc` (413 when exceeded), **rate limit**
 * on `/rpc` (429 when exceeded). **Authentication is not applied** — add middleware or
 * terminate TLS/auth at your edge.
 */
export function applyTransportPreset(app: Hono, config: TransportConfig): void {
  app.use(
    "*",
    cors({
      origin: config.corsOrigin,
      allowMethods: ["GET", "HEAD", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      exposeHeaders: [
        "RateLimit-Limit",
        "RateLimit-Remaining",
        "RateLimit-Reset",
      ],
      credentials: Boolean(config.corsAllowCredentials),
    }),
  );

  app.use(
    "/rpc",
    bodyLimit({
      maxSize: config.rpcBodyLimitBytes,
      onError: (c) => {
        return c.json({ message: "Request body exceeds limit." }, 413);
      },
    }),
  );

  app.use(
    "/rpc",
    rateLimiter({
      windowMs: config.rateLimitWindowMs,
      limit: config.rateLimitMax,
      standardHeaders: "draft-6",
      keyGenerator: (c) => rateLimitKey(c),
    }),
  );
}
