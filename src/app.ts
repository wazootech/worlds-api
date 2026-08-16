import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import type { Context } from "hono";
import type { Env } from "./env";
import { checkRateLimit, isOriginAllowed } from "./lib/abuse";
import { sha256Hex } from "./lib/crypto";

function allowedOrigin(c: Context<{ Bindings: Env }>): string | null {
  const origin = c.req.header("Origin");
  return origin && isOriginAllowed(origin, c.env as unknown as Env)
    ? origin
    : null;
}
import { registerHealthRoutes } from "./routes/health";
import { registerWorldsRoutes } from "./routes/worlds";
import { registerImportExportRoutes } from "./routes/import-export";
import { registerSearchRoutes } from "./routes/search";
import { registerSparqlRoutes } from "./routes/sparql";
import { registerApiKeysRoutes } from "./routes/api-keys";

const app = new OpenAPIHono<{ Bindings: Env }>();

// CORS is origin-restricted (default: console origins + preview workers),
// never "*". Requests without an Origin header are unaffected.
app.use(
  "*",
  cors({
    origin: (origin, c) =>
      isOriginAllowed(origin, c.env as unknown as Env) ? origin : null,
  }),
);

// Per-key token-bucket rate limiting (in-memory). Exempts the health and
// OpenAPI endpoints so probes and spec fetches are never throttled.
app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === "/health" || path === "/openapi.json") return next();

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
});

app.openAPIRegistry.registerComponent("securitySchemes", "bearerWorldsToken", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "wzw",
  description: "Worlds API data-plane token.",
});

app.onError((err, c) => {
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
});

app.notFound((c) => {
  const origin = allowedOrigin(c);
  if (origin) c.header("Access-Control-Allow-Origin", origin);
  return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
});

import { registerReindexRoutes } from "./routes/reindex";

registerHealthRoutes(app);
registerWorldsRoutes(app);
registerImportExportRoutes(app);
registerSearchRoutes(app);
registerSparqlRoutes(app);
registerApiKeysRoutes(app);
registerReindexRoutes(app);

/**
 * openApiDocOptions is the OpenAPI document configuration. It is the single
 * source of truth for the served spec (GET /openapi.json) and the committed
 * snapshot in openapi/openapi.json, so the two cannot drift apart.
 */
export const openApiDocOptions = {
  openapi: "3.0.0",
  info: {
    title: "Worlds API",
    version: "0.1.0",
    description:
      "Data-plane API for Wazoo Worlds — search, SPARQL, import, export, and World lifecycle.",
  },
  servers: [{ url: "https://worlds-api.wazoo.dev", description: "Worlds API" }],
  security: [{ bearerWorldsToken: [] }],
};

app.doc("/openapi.json", openApiDocOptions);

export default app;
