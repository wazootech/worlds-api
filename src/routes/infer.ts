import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { backfillInference } from "@worlds/cloudflare";
import type { Env } from "../env";
import { authorize, requireAccess, unauthorized } from "../lib/auth";
import { SCOPE_DATA_WRITE } from "../lib/auth";
import { resolveWorldDatabase } from "../lib/world-db";
import { respond } from "../lib/respond";
import { writeBudgetError, writeBudgetExceeded } from "../lib/write-budget";
import { ErrorResponseSchema, worldIdParam } from "../lib/schemas";

export function registerInferRoutes(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(
    createRoute({
      method: "post",
      path: "/worlds/{worldId}/infer",
      tags: ["Worlds"],
      operationId: "backfillWorldInference",
      summary: "Back-fill inference for a world's existing data",
      description:
        "Materializes OWL 2 RL inference for data a world already holds. Enabling inference on a world only reacts to later writes; call this once afterwards to cover what is stored. It reads the world's asserted quads, runs the reasoner once, clears the world's inferred quads and writes the closure. Asserted quads are never changed. It is idempotent and safe to repeat; a failure part way leaves some inferred quads, so call it again. The world must have inference enabled. A world larger than its maxAssertedQuads limit is refused before any write (422 INFERENCE_SIZE_GUARD).",
      "x-mint": {
        metadata: { title: "Back-fill inference for a world's existing data" },
      },
      security: [{ bearerWorldsToken: [] }],
      request: { params: worldIdParam },
      responses: {
        200: {
          description: "The back-fill ran.",
          content: {
            "application/json": {
              schema: z.object({
                ok: z.literal(true),
                assertedQuads: z.number().int().nonnegative().openapi({
                  description: "Asserted quads the reasoner read.",
                }),
                derivedWritten: z.number().int().nonnegative().openapi({
                  description: "Inferred quads stored after the back-fill.",
                }),
                derivedRemoved: z.number().int().nonnegative().openapi({
                  description:
                    "Inferred quads cleared before writing the closure.",
                }),
                inconsistencyCount: z.number().int().nonnegative().openapi({
                  description:
                    "OWL 2 RL consistency rules the data violates. They do not block the back-fill.",
                }),
              }),
            },
          },
        },
        404: {
          description: "World database not found",
          content: { "application/json": { schema: ErrorResponseSchema } },
        },
        409: {
          description:
            "Inference is not enabled for this world (INFERENCE_NOT_ENABLED), or the database is missing the quads.derived column (INFERENCE_UNAVAILABLE).",
          content: { "application/json": { schema: ErrorResponseSchema } },
        },
        422: {
          description:
            "The world has more asserted quads than its maxAssertedQuads limit (INFERENCE_SIZE_GUARD). Nothing was written.",
          content: { "application/json": { schema: ErrorResponseSchema } },
        },
        429: {
          description:
            "The namespace has used its daily database write budget (WRITE_BUDGET_EXCEEDED). Nothing was written; it resets at 00:00 UTC.",
          content: { "application/json": { schema: ErrorResponseSchema } },
        },
        500: {
          description: "The back-fill failed",
          content: { "application/json": { schema: ErrorResponseSchema } },
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
          { error: { code: "NOT_FOUND", message: "World database not found" } },
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

      if (!ref.inference?.enabled) {
        return respond(
          c,
          {
            error: {
              code: "INFERENCE_NOT_ENABLED",
              message:
                "Enable inference on this world (PATCH /worlds/{worldId}) before back-filling it",
            },
          },
          409,
        );
      }

      if (await writeBudgetExceeded(env, ref.namespace)) {
        return respond(c, writeBudgetError(env), 429);
      }

      try {
        const report = await backfillInference({
          database: env.DB,
          worldId,
          inference: ref.inference,
        });
        return respond(c, {
          ok: true as const,
          assertedQuads: report.assertedQuads,
          derivedWritten: report.derivedWritten,
          derivedRemoved: report.derivedRemoved,
          inconsistencyCount: report.inconsistencies.length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if ((error as Error)?.name === "InferenceSizeGuardError") {
          return respond(
            c,
            { error: { code: "INFERENCE_SIZE_GUARD", message } },
            422,
          );
        }
        if (/quads\.derived|missing column derived/.test(message)) {
          return respond(
            c,
            { error: { code: "INFERENCE_UNAVAILABLE", message } },
            409,
          );
        }
        return respond(c, { error: { code: "INTERNAL", message } }, 500);
      }
    },
  );
}
