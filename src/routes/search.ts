import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { buildSearchResultId } from "@worlds/sqlite/sql-core";
import type { Env } from "../env";
import { authorize, requireAccess, unauthorized } from "../lib/auth";
import { SCOPE_DATA_READ } from "../lib/auth";
import { resolveWorldDatabase, getWorldSdk } from "../lib/world-db";
import { respond } from "../lib/respond";
import {
  SearchRequestSchema,
  SearchResponseSchema,
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
        "Full-text and vector similarity search across a world's graph data. Returns ranked results with id, subject, predicate, content, score, and scoreType on the normalized 0–1 scale, plus the mode that actually ran. Falls back to LIKE-based search if the primary engine is unavailable.",
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
            "application/json": { schema: SearchResponseSchema },
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

      const limit = body.limit;
      // D2: the candidate pool is provider-internal — fetch at least the
      // requested result count and the world's configured recall, then slice
      // to `limit` after ranking.
      const candidateCount = Math.max(limit, ref.topK);
      const client = await getWorldSdk(env, ref, candidateCount);

      try {
        const response = await client.search({
          query: body.query,
          minScore: body.minScore ?? ref.minScore,
          ...(body.filter?.include && { include: body.filter.include }),
          ...(body.filter?.exclude && { exclude: body.filter.exclude }),
        });

        return respond(c, {
          results: (response.results ?? []).slice(0, limit).map((r) => ({
            id: r.id,
            subject: r.subject,
            predicate: r.predicate,
            graph: r.graph,
            content: r.text,
            score: r.score,
            scoreType: r.scoreType ?? "rrf",
          })),
          mode: "keyword",
        });
      } catch {
        const likePattern = `%${body.query}%`;

        // Fallback LIKE search. The world_uid scope must group all three LIKE
        // clauses or operator precedence binds it to `o LIKE` only, leaking
        // quads from other worlds (worlds-api#74).
        const stmt = env.DB.prepare(
          "SELECT s, p, o, g FROM quads WHERE (s LIKE ? OR p LIKE ? OR o LIKE ?) AND world_uid = ? ORDER BY s LIMIT ?",
        ).bind(likePattern, likePattern, likePattern, worldUid, limit);
        const quadRows = await stmt.all<{
          s: string;
          p: string;
          o: string;
          g: string;
        }>();

        return respond(c, {
          results: await Promise.all(
            quadRows.results.map(async (r) => ({
              id: await buildSearchResultId({
                subject: r.s,
                predicate: r.p,
                graph: r.g,
                text: r.o,
              }),
              subject: r.s,
              predicate: r.p,
              graph: r.g,
              content: r.o,
              score: null,
              scoreType: "unranked",
            })),
          ),
          mode: "fallback",
        });
      }
    },
  );
}
