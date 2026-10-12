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
import { getEmbeddingModel } from "../lib/embeddings/catalog";
import {
  getCredential,
  remainingBudget,
  setWorldState,
} from "../lib/embeddings/store";
import { worldIdParam } from "../lib/schemas";

/**
 * VectorSyncSchema mirrors @worlds/cloudflare's VectorSyncReport: what the
 * reindex managed to write to the outside-D1 vector index (worlds-cloudflare#40).
 */
const VectorSyncSchema = z
  .object({
    enabled: z.boolean(),
    attempted: z.number().int().nonnegative(),
    upserted: z.number().int().nonnegative(),
    failedUpserts: z.number().int().nonnegative(),
    embeddingFailures: z.number().int().nonnegative(),
    staleDeleteFailures: z.number().int().nonnegative(),
    errors: z.array(z.string()),
  })
  .openapi("VectorSyncReport");

type VectorSync = z.infer<typeof VectorSyncSchema>;

function readVectorSync(report: unknown): VectorSync | undefined {
  const parsed = VectorSyncSchema.safeParse(
    (report as { vectorSync?: unknown } | null)?.vectorSync,
  );
  return parsed.success ? parsed.data : undefined;
}

function vectorSyncFailed(vectorSync: VectorSync | undefined): boolean {
  return Boolean(
    vectorSync &&
    (vectorSync.failedUpserts > 0 ||
      vectorSync.embeddingFailures > 0 ||
      vectorSync.staleDeleteFailures > 0),
  );
}

export function registerReindexRoutes(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(
    createRoute({
      method: "post",
      path: "/worlds/{worldId}/reindex",
      tags: ["Reindex"],
      operationId: "reindexWorld",
      summary: "Reindex world vector & FTS indexes",
      description:
        "Rebuild the vector and full-text search indexes for a world from its stored RDF quads. Required after changing the embedding model (the world is stale and search is keyword-only until it completes) and useful to repair search quality. The full-text index is always rebuilt from D1; if any vector could not be embedded, written or cleaned up, status is completed_with_vector_errors and vectorSync says what failed. Rerunning reindex repairs it. Embedding spend is checked against the namespace's daily budget first; an exhausted budget returns 429 EMBEDDING_BUDGET_EXCEEDED.",
      "x-mint": { metadata: { title: "Reindex world vector & FTS indexes" } },
      security: [{ bearerWorldsToken: [] }],
      request: {
        params: worldIdParam,
      },
      responses: {
        200: {
          description:
            "Reindex ran. status is completed, or completed_with_vector_errors when the vector index could not be fully synced (see vectorSync).",
          content: {
            "application/json": {
              schema: z.object({
                ok: z.literal(true),
                status: z.enum(["completed", "completed_with_vector_errors"]),
                processedQuadCount: z.number().int().nonnegative(),
                chunkRowCount: z.number().int().nonnegative(),
                vectorSync: VectorSyncSchema.optional(),
              }),
            },
          },
        },
        429: {
          description:
            "The namespace's daily embedding budget is exhausted (EMBEDDING_BUDGET_EXCEEDED). Nothing was reindexed or spent.",
          content: {
            "application/json": {
              schema: z.object({
                error: z.object({ code: z.string(), message: z.string() }),
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

      // Spend guard (design 4.3): refuse before any provider call when the
      // namespace has no budget left and an embedder would actually run. The
      // embedder re-checks atomically per batch, so a lookup failure here only
      // skips the early refusal.
      let budgetExhausted = false;
      try {
        budgetExhausted =
          Boolean(getEmbeddingModel(ref.embeddingModel)) &&
          (await getCredential(env, ref.namespace))?.status === "active" &&
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
              message:
                "The daily embedding budget for this namespace is used up",
            },
          },
          429,
        );
      }

      try {
        const sdk = await getWorldSdk(env, ref, undefined, {
          forReindex: true,
        });
        if (typeof sdk.reindex !== "function") {
          throw new Error("Configured Worlds SDK does not support reindexing");
        }
        const report = (await sdk.reindex()) as unknown as ReindexResponse;
        const vectorSync = readVectorSync(report);
        // Reconcile embedding state from what the engine actually wrote:
        // ready only with zero failures, partial once some vectors landed. A
        // failed state write leaves the world stale (keyword-only), never a 500.
        if (vectorSync?.enabled) {
          const next = !vectorSyncFailed(vectorSync)
            ? "ready"
            : vectorSync.upserted > 0
              ? "partial"
              : "stale";
          try {
            await setWorldState(env, worldId, next, ref.embeddingModel);
          } catch {
            console.warn("embedding state not recorded after reindex", {
              worldId,
            });
          }
        }
        return respond(c, {
          ok: true,
          status: vectorSyncFailed(vectorSync)
            ? "completed_with_vector_errors"
            : "completed",
          processedQuadCount: report.processedQuadCount,
          chunkRowCount: report.chunkRowCount,
          ...(vectorSync && { vectorSync }),
        });
      } finally {
        clearSdkCacheForWorld(worldId);
      }
    },
  );
}
