import type { Context } from "hono";
import type { ReindexResponse } from "@worlds/sdk/search-index";
import type { Env } from "../../env";
import {
  clearSdkCacheForWorld,
  getWorldSdk,
  type resolveWorldDatabase,
} from "../../lib/world-db";
import { respond } from "../../lib/respond";
import {
  getWorldState,
  setWorldState,
  type WorldEmbeddingStateValue,
} from "../../lib/embeddings/store";
import { canEmbedForReindex } from "../../lib/embeddings/service";
import { planReindexWindow } from "../../lib/embeddings/reindex-window";
import {
  cleanupWorldVectors,
  type VectorCleanupReport,
} from "../../lib/embeddings/vectors";
import { readVectorSync, vectorSyncFailed, withCleanup } from "./vector-sync";

type WorldRef = NonNullable<Awaited<ReturnType<typeof resolveWorldDatabase>>>;

export async function runReindex(
  c: Context,
  env: Env,
  ref: WorldRef,
  worldId: string,
) {
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
        await setWorldState(env, worldId, next, ref.embeddingModel, nextCursor);
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
        await recordState(vectorSync.upserted > 0 ? "partial" : "stale", null);
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
}
