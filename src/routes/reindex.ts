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
  getCredentialForModel,
  getWorldState,
  reindexMaxChunks,
  remainingBudget,
  setWorldState,
  type WorldEmbeddingStateValue,
} from "../lib/embeddings/store";
import { canEmbedForReindex } from "../lib/embeddings/service";
import { planReindexWindow } from "../lib/embeddings/reindex-window";
import {
  cleanupOk,
  cleanupWorldVectors,
  type VectorCleanupReport,
} from "../lib/embeddings/vectors";
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

/**
 * Folds an orphan-vector cleanup that failed or did not finish into the
 * vectorSync report, so a reindex that could not remove stale vectors says so
 * (completed_with_vector_errors) instead of reporting a clean run.
 */
function withCleanup(
  vectorSync: VectorSync | undefined,
  cleanup: VectorCleanupReport,
): VectorSync | undefined {
  if (cleanupOk(cleanup)) return vectorSync;
  const failures = cleanup.failed + (cleanup.incomplete ? 1 : 0);
  const errors = cleanup.incomplete
    ? [...cleanup.errors, "cleanup: incomplete"]
    : cleanup.errors;
  const base = vectorSync ?? {
    enabled: false,
    attempted: 0,
    upserted: 0,
    failedUpserts: 0,
    embeddingFailures: 0,
    staleDeleteFailures: 0,
    errors: [],
  };
  return {
    ...base,
    staleDeleteFailures: base.staleDeleteFailures + failures,
    errors: [...base.errors, ...errors],
  };
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
        "Rebuild the vector and full-text search indexes for a world from its stored RDF quads. Required after changing the embedding model (the world is stale and search is keyword-only until it completes) and useful to repair search quality. The full-text index is always rebuilt from D1; if any vector could not be embedded, written or cleaned up, status is completed_with_vector_errors and vectorSync says what failed. Rerunning reindex repairs it. Embedding spend is checked against the namespace's daily write budget first; an exhausted budget returns 429 EMBEDDING_BUDGET_EXCEEDED. Worlds with more text than EMBEDDING_REINDEX_MAX_CHUNKS are reindexed in windows across several calls: each call embeds only the next window, so no chunk is embedded twice and the world becomes ready when the last window completes.",
      "x-mint": { metadata: { title: "Reindex world vector & FTS indexes" } },
      security: [{ bearerWorldsToken: [] }],
      request: {
        params: worldIdParam,
      },
      responses: {
        200: {
          description:
            "Reindex ran. status is completed, completed_with_vector_errors when the vector index could not be fully synced (see vectorSync; calling again retries the failed window), or in_progress when a large world is reindexed in windows: call again until completed (continuation.remainingChunksEstimate says how much is left).",
          content: {
            "application/json": {
              schema: z.object({
                ok: z.literal(true),
                status: z.enum([
                  "completed",
                  "completed_with_vector_errors",
                  "in_progress",
                ]),
                processedQuadCount: z.number().int().nonnegative(),
                chunkRowCount: z.number().int().nonnegative(),
                vectorSync: VectorSyncSchema.optional(),
                continuation: z
                  .object({
                    remainingChunksEstimate: z.number().int().nonnegative(),
                  })
                  .optional(),
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
              message:
                "The daily embedding budget for this namespace is used up",
            },
          },
          429,
        );
      }

      try {
        // Repair first: vectors of chunk rows whose quads were deleted must
        // not survive a reindex (a failure here stays findable by a retry).
        let cleanup: VectorCleanupReport;
        try {
          cleanup = await cleanupWorldVectors(env, worldId, "orphans");
        } catch (error) {
          console.warn("orphan vector cleanup failed before reindex", {
            worldId,
            reason: error instanceof Error ? error.name : "unknown",
          });
          cleanup = {
            enabled: true,
            attempted: 0,
            deleted: 0,
            failed: 1,
            incomplete: false,
            orphanChunkRows: 0,
            errors: ["cleanup: failed"],
          };
        }

        const previous = await getWorldState(env, worldId).catch(() => null);
        const cursor =
          previous?.model === ref.embeddingModel
            ? (previous.reindex_cursor ?? null)
            : null;
        const plan = (await canEmbedForReindex(env, ref))
          ? await planReindexWindow(env, worldId, cursor)
          : ({ windowed: false } as const);

        const recordState = async (
          next: WorldEmbeddingStateValue,
          nextCursor: string | null,
        ) => {
          try {
            await setWorldState(
              env,
              worldId,
              next,
              ref.embeddingModel,
              nextCursor,
            );
          } catch {
            console.warn("embedding state not recorded after reindex", {
              worldId,
            });
          }
        };

        // A resumed pass whose previous window was the last: nothing is left
        // to embed, only the state transition (and any cleanup failure).
        if (plan.windowed && plan.subjects.length === 0) {
          const synced = withCleanup(undefined, cleanup);
          const bad = vectorSyncFailed(synced);
          await recordState(bad ? "stale" : "ready", null);
          return respond(c, {
            ok: true,
            status: bad ? "completed_with_vector_errors" : "completed",
            processedQuadCount: 0,
            chunkRowCount: 0,
            ...(synced && { vectorSync: synced }),
          });
        }

        // Record that this world may now hold vectors before any are written,
        // so a crash mid-run cannot leave vectors that cleanup would not find.
        if (!previous && (await canEmbedForReindex(env, ref))) {
          await recordState("stale", null);
        }

        const sdk = await getWorldSdk(env, ref, undefined, {
          forReindex: true,
          ...(plan.windowed && { includeSubjects: plan.subjects }),
        });
        if (typeof sdk.reindex !== "function") {
          throw new Error("Configured Worlds SDK does not support reindexing");
        }
        const report = (await sdk.reindex()) as unknown as ReindexResponse;
        const vectorSync = withCleanup(readVectorSync(report), cleanup);
        const failed = vectorSyncFailed(vectorSync);

        // Reconcile embedding state from what the engine actually wrote:
        // ready only with zero failures, partial once some vectors landed. A
        // failed state write leaves the world stale (keyword-only), never a 500.
        if (vectorSync?.enabled) {
          if (plan.windowed && !failed && !plan.done) {
            // Window finished cleanly with more to go: keep the state (a
            // stale world must not claim partial while old-model vectors
            // remain) and store where to resume.
            await recordState(previous?.state ?? "stale", plan.lastSubject);
            return respond(c, {
              ok: true,
              status: "in_progress",
              processedQuadCount: report.processedQuadCount,
              chunkRowCount: report.chunkRowCount,
              vectorSync,
              continuation: { remainingChunksEstimate: plan.remaining },
            });
          }
          if (!failed) {
            await recordState("ready", null);
          } else if (plan.windowed) {
            // Keep the cursor: the next call retries this same window and
            // never re-embeds the windows already finished.
            const live =
              previous?.state === "ready" || previous?.state === "partial";
            await recordState(
              live && vectorSync.upserted > 0
                ? "partial"
                : live
                  ? previous.state
                  : "stale",
              cursor,
            );
          } else {
            await recordState(
              vectorSync.upserted > 0 ? "partial" : "stale",
              null,
            );
          }
        }
        return respond(c, {
          ok: true,
          status: failed ? "completed_with_vector_errors" : "completed",
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
