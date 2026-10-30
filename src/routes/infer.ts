import type { OpenAPIHono } from "@hono/zod-openapi";
import { backfillInference } from "@worlds/cloudflare";
import type { Env } from "../env";
import { authorize, requireAccess, unauthorized } from "../lib/auth";
import { SCOPE_DATA_WRITE } from "../lib/auth";
import { resolveWorldDatabase } from "../lib/world-db";
import { respond } from "../lib/respond";
import { writeBudgetRefusal } from "../lib/write-budget";
import { inferRoute } from "./infer/route";

export function registerInferRoutes(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(inferRoute, async (c) => {
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

    const refusal = await writeBudgetRefusal(env, ref.namespace);
    if (refusal) {
      return respond(c, refusal, 429);
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
  });
}
