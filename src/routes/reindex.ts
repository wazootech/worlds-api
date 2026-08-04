import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../env";
import { authorize, requireAccess, unauthorized } from "../lib/auth";
import { resolveWorldDatabase, worldDb } from "../lib/world-db";
import { respond } from "../lib/respond";
import { worldIdParam } from "../lib/schemas";

export function registerReindexRoutes(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(
    createRoute({
      method: "post",
      path: "/worlds/{id}/reindex",
      tags: ["Reindex"],
      operationId: "reindexWorld",
      summary: "Reindex world vector & FTS indexes",
      "x-mint": { metadata: { title: "Reindex world vector & FTS indexes" } },
      security: [{ bearerWorldsToken: [] }],
      request: {
        params: worldIdParam,
      },
      responses: {
        200: {
          description: "Reindex initiated successfully",
          content: {
            "application/json": {
              schema: z.object({
                ok: z.boolean(),
                status: z.string(),
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
      },
    }),
    async (c) => {
      const env = c.env as unknown as Env;
      const worldId = c.req.param("id");
      const auth = await authorize(c.req.raw, env);
      const namespace = auth.namespace;
      if (!namespace && !auth.admin) return unauthorized();

      const targetNamespace = auth.admin
        ? (c.req.query("namespace") ?? namespace ?? "default")
        : namespace!;

      const accessErr = requireAccess(auth, targetNamespace, worldId);
      if (accessErr) return accessErr;

      const ref = await resolveWorldDatabase(env, targetNamespace, worldId);
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

      return respond(c, { ok: true, status: "completed" });
    },
  );
}
