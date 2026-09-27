import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../env";
import { assertControlPlaneSchema } from "../lib/d1-schema";
import { getDb } from "../lib/db";
import { respond } from "../lib/respond";

const route = createRoute({
  method: "get",
  path: "/health",
  security: [],
  tags: ["Health"],
  operationId: "getHealth",
  summary: "Get health",
  description:
    "Liveness probe. Returns 200 when the service can reach its database; 503 when the database is unreachable.",
  "x-mint": { metadata: { title: "Get health" } },
  responses: {
    200: {
      description: "Service is healthy",
      content: {
        "application/json": {
          schema: z.object({ status: z.literal("ok") }),
        },
      },
    },
    503: {
      description: "Service is degraded",
      content: {
        "application/json": {
          schema: z.object({
            status: z.literal("degraded"),
            error: z.string(),
          }),
        },
      },
    },
  },
});

const readyRoute = createRoute({
  method: "get",
  path: "/ready",
  security: [],
  tags: ["Health"],
  operationId: "getReadiness",
  summary: "Get readiness",
  description:
    "Readiness probe. Returns 200 only when the control-plane schema has the canonical columns.",
  "x-mint": { metadata: { title: "Get readiness" } },
  responses: {
    200: {
      description: "Service is ready",
      content: {
        "application/json": {
          schema: z.object({
            status: z.literal("ready"),
            schema: z.literal("canonical"),
          }),
        },
      },
    },
    503: {
      description: "Service is not ready",
      content: {
        "application/json": {
          schema: z.object({
            status: z.literal("not_ready"),
            error: z.string(),
          }),
        },
      },
    },
  },
});

export function registerHealthRoutes(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(route, async (c) => {
    const env = c.env as unknown as Env;
    try {
      const db = getDb(env);
      await db.prepare("SELECT 1").first();
      return respond(c, { status: "ok" });
    } catch (err) {
      return respond(
        c,
        {
          status: "degraded",
          error: err instanceof Error ? err.message : "Unknown error",
        },
        503,
      );
    }
  });

  app.openapi(readyRoute, async (c) => {
    const env = c.env as unknown as Env;
    try {
      const db = getDb(env);
      await db.prepare("SELECT 1").first();
      await assertControlPlaneSchema(db);
      return respond(c, { status: "ready", schema: "canonical" });
    } catch (err) {
      return respond(
        c,
        {
          status: "not_ready",
          error: err instanceof Error ? err.message : "Unknown error",
        },
        503,
      );
    }
  });
}
