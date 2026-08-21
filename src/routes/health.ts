import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../env";
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

export function registerHealthRoutes(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(route, async (c) => {
    const env = c.env as unknown as Env;
    try {
      const db = getDb(env);
      await db.execute("SELECT 1");
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
}
