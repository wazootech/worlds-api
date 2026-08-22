import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { createLibsqlWorldsSdk } from "@worlds/libsql";
import type { Env } from "../env";
import { authorize, requireAccess, unauthorized } from "../lib/auth";
import { SCOPE_DATA_READ } from "../lib/auth";
import { resolveWorldDatabase, worldDb } from "../lib/world-db";
import { respond } from "../lib/respond";
import {
  SearchRequestSchema,
  SearchResultSchema,
  worldIdParam,
} from "../lib/schemas";

export function registerSearchRoutes(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(
    createRoute({
      method: "post",
      path: "/worlds/{id}/search",
      tags: ["Search"],
      operationId: "searchWorld",
      summary: "Search world",
      description:
        "Full-text and vector similarity search across a world's graph data. Returns ranked results with subject, predicate, content, and relevance score. Falls back to LIKE-based search if the vector index is unavailable.",
      "x-mint": { metadata: { title: "Search world" } },
      security: [{ bearerWorldsToken: [] }],
      request: {
        params: worldIdParam,
        body: {
          required: true,
          content: {
            "application/json": { schema: SearchRequestSchema },
          },
        },
      },
      responses: {
        200: {
          description: "Search results",
          content: {
            "application/json": {
              schema: z.object({
                results: z.array(SearchResultSchema),
                mode: z.string().optional(),
              }),
            },
          },
        },
        400: {
          description: "Bad request",
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
      const worldUid = c.req.param("id");
      const auth = await authorize(c.req.raw, env);
      const body = c.req.valid("json");

      if (!auth.admin && !auth.namespace) return unauthorized();

      const ref = await resolveWorldDatabase(env, worldUid);
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
        worldUid,
        SCOPE_DATA_READ,
      );
      if (accessErr) return accessErr;

      if (!body.query) {
        return respond(
          c,
          {
            error: {
              code: "INVALID_ARGUMENT",
              message: "query is required",
            },
          },
          400,
        );
      }

      const limit = body.limit ?? 20;
      const db = worldDb(ref);
      const client = await createLibsqlWorldsSdk({ client: db });

      try {
        const searchTopK = body.topK ?? ref.topK;
        const searchMinScore = body.minScore ?? ref.minScore;
        const response = await client.search(
          {
            query: body.query,
            ...(searchTopK !== undefined && { topK: searchTopK }),
            ...(searchMinScore !== undefined && { minScore: searchMinScore }),
          } as Parameters<typeof client.search>[0],
        );

        return respond(c, {
          results: (response.results ?? []).slice(0, limit).map((r) => ({
            subject: r.subject,
            predicate: r.predicate,
            graph: r.graph,
            content: r.text,
            score: r.score,
          })),
        });
      } catch {
        const likePattern = `%${body.query}%`;

        const quadRows = await db.execute({
          sql:
            "SELECT s, p, o FROM quads WHERE s LIKE ? OR p LIKE ? OR o LIKE ? LIMIT ?",
          args: [likePattern, likePattern, likePattern, limit],
        });

        return respond(c, {
          results: quadRows.rows.map((r) => ({
            subject: String(r.s),
            predicate: String(r.p),
            object: String(r.o),
          })),
          mode: "fallback",
        });
      }
    },
  );
}
