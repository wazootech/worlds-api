import { createRoute, z } from "@hono/zod-openapi";
import { worldIdParam } from "../../lib/schemas";
import { VectorSyncSchema } from "./vector-sync";

export const reindexRoute = createRoute({
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
});
