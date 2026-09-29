import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../env";
import type { ReindexResponse } from "@worlds/sdk/search-index";
import { authorize, requireAccess, unauthorized } from "../lib/auth";
import { SCOPE_DATA_WRITE } from "../lib/auth";
import {
  clearSdkCacheForWorld,
  getWorldSdk,
  resolveWorldDatabase,
} from "../lib/world-db";
import { respond } from "../lib/respond";
import { worldIdParam } from "../lib/schemas";

export function registerReindexRoutes(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(
    createRoute({
      method: "post",
      path: "/worlds/{worldId}/reindex",
      tags: ["Reindex"],
      operationId: "reindexWorld",
      summary: "Reindex world vector & FTS indexes",
      description:
        "Rebuild the vector and full-text search indexes for a world from its stored RDF quads. Use after changing the embedding model or to repair search quality.",
      "x-mint": { metadata: { title: "Reindex world vector & FTS indexes" } },
      security: [{ bearerWorldsToken: [] }],
      request: {
        params: worldIdParam,
      },
      responses: {
        200: {
          description: "Reindex completed successfully",
          content: {
            "application/json": {
              schema: z.object({
                ok: z.literal(true),
                status: z.literal("completed"),
                processedQuadCount: z.number().int().nonnegative(),
                chunkRowCount: z.number().int().nonnegative(),
              }),
            },
          },
        },
        404: {
          description: "World database not found",
          content: {
            "application/json": {
              schema: z.object({
                error: z.object({ code: z.string(), message: z.string() }),
              }),
            },
          },
        },
        500: {
          description: "Reindex failed",
          content: {
            "application/json": {
              schema: z.object({
                error: z.object({ code: z.string(), message: z.string() }),
              }),
            },
          },
        },
      },
    }),
    async (c) => {
      const env = c.env as unknown as Env;
      const worldId = c.req.param("worldId");
      const auth = await authorize(c.req.raw, env);

      if (!auth.admin && !auth.namespace) return unauthorized();

      const ref = await resolveWorldDatabase(env, worldId);
      if (!ref) {
        return respond(
          c,
          {
            error: {
              code: "NOT_FOUND",
              message: "World database not found",
            },
          },
          404,
        );
      }

      const accessErr = requireAccess(
        auth,
        ref.namespace,
        worldId,
        SCOPE_DATA_WRITE,
      );
      if (accessErr) return accessErr;

      try {
        const sdk = await getWorldSdk(env, ref);
        if (typeof sdk.reindex !== "function") {
          throw new Error("Configured Worlds SDK does not support reindexing");
        }
        const report = (await sdk.reindex()) as unknown as ReindexResponse;
        return respond(c, { ok: true, status: "completed", ...report });
      } finally {
        clearSdkCacheForWorld(worldId);
      }
    },
  );
}
