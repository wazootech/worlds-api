import { Hono } from "@hono/hono";
import type { TransportConfig } from "./types.ts";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Self-implemented CORS middleware (replaces @hono/hono/cors).
 */
function applyCors(app: Hono, config: TransportConfig): void {
  const origin = config.corsOrigin;
  const allowOrigin = Array.isArray(origin) ? origin.join(",") : origin;

  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": allowOrigin,
          "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Expose-Headers":
            "RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset",
          ...(config.corsAllowCredentials
            ? { "Access-Control-Allow-Credentials": "true" }
            : {}),
        },
      });
    }

    await next();

    c.res.headers.set("Access-Control-Allow-Origin", allowOrigin);
    c.res.headers.set(
      "Access-Control-Expose-Headers",
      "RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset",
    );
    if (config.corsAllowCredentials) {
      c.res.headers.set("Access-Control-Allow-Credentials", "true");
    }
  });
}

/**
 * Self-implemented body size limit middleware (replaces @hono/hono/body-limit).
 */
function applyBodyLimit(app: Hono, config: TransportConfig): void {
  app.use("/rpc", async (c, next) => {
    const contentLength = c.req.header("content-length");
    if (contentLength && Number(contentLength) > config.rpcBodyLimitBytes) {
      return c.json({ message: "Request body exceeds limit." }, 413);
    }
    await next();
  });
}

/**
 * Generates a rate limit key from the request context.
 */
function rateLimitKey(
  c: { req: { header(name: string): string | undefined } },
): string {
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
 * Simple in-memory rate limiter.
 */
function applyRateLimiter(app: Hono, config: TransportConfig): void {
  app.use("/rpc", async (c, next) => {
    const key = rateLimitKey(c);
    const now = Date.now();
    const entry = rateLimitStore.get(key);

    if (!entry || entry.resetTime <= now) {
      // New window
      rateLimitStore.set(key, {
        count: 1,
        resetTime: now + config.rateLimitWindowMs,
      });
      c.res.headers.set("RateLimit-Limit", config.rateLimitMax.toString());
      c.res.headers.set(
        "RateLimit-Remaining",
        (config.rateLimitMax - 1).toString(),
      );
      c.res.headers.set(
        "RateLimit-Reset",
        Math.ceil(config.rateLimitWindowMs / 1000).toString(),
      );
      await next();
      return;
    }

    if (entry.count >= config.rateLimitMax) {
      // Rate limit exceeded
      c.res.headers.set("RateLimit-Limit", config.rateLimitMax.toString());
      c.res.headers.set("RateLimit-Remaining", "0");
      c.res.headers.set(
        "RateLimit-Reset",
        Math.ceil((entry.resetTime - now) / 1000).toString(),
      );
      return c.json(
        { message: "Too many requests. Please try again later." },
        429,
      );
    }

    // Within limit
    entry.count++;
    c.res.headers.set("RateLimit-Limit", config.rateLimitMax.toString());
    c.res.headers.set(
      "RateLimit-Remaining",
      (config.rateLimitMax - entry.count).toString(),
    );
    c.res.headers.set(
      "RateLimit-Reset",
      Math.ceil((entry.resetTime - now) / 1000).toString(),
    );
    await next();
  });
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
  applyCors(app, config);
  applyBodyLimit(app, config);
  applyRateLimiter(app, config);
}
