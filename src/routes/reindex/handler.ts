import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../../env";
import {
  authorize,
  requireAccess,
  SCOPE_DATA_WRITE,
  unauthorized,
} from "../../lib/auth";
import { resolveWorldDatabase } from "../../lib/world-db";
import { respond } from "../../lib/respond";
import { getEmbeddingModel } from "../../lib/embeddings/catalog";
import {
  getCredentialForModel,
  remainingBudget,
} from "../../lib/embeddings/store";
import { reindexRoute } from "./route";
import { runReindex } from "./run";

export function registerReindex(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(reindexRoute, async (c) => {
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

    // Spend guard (design 4.3): refuse before any provider call when the
    // namespace has no budget left and an embedder would actually run. The
    // embedder re-checks atomically per batch, so a lookup failure here only
    // skips the early refusal.
    let budgetExhausted: boolean;
    try {
      budgetExhausted =
        Boolean(getEmbeddingModel(ref.embeddingModel)) &&
        (await getCredentialForModel(env, ref.namespace, ref.embeddingModel))
          ?.status === "active" &&
        (await remainingBudget(env, ref.namespace)) <= 0;
    } catch {
      budgetExhausted = false;
    }
    if (budgetExhausted) {
      return respond(
        c,
        {
          error: {
            code: "EMBEDDING_BUDGET_EXCEEDED",
            message: "The daily embedding budget for this namespace is used up",
          },
        },
        429,
      );
    }
    return runReindex(c, env, ref, worldId);
  });
}
