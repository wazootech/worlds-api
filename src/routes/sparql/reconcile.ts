import type { Env } from "../../env";
import {
  cleanupOk,
  cleanupWorldVectors,
  markWorldStale,
  type VectorCleanupReport,
} from "../../lib/embeddings/vectors";

/**
 * Post-update vector reconciliation. Never throws: the update is already
 * committed, so a failure is reported in the response and logged, and the
 * world is marked stale so search cannot serve text whose vector could not be
 * removed (reindex retries the cleanup). Returns undefined when there was
 * nothing to do (no Vectorize binding, or no orphaned vectors).
 */
export async function reconcileAfterUpdate(
  env: Env,
  worldId: string,
): Promise<VectorCleanupReport | undefined> {
  try {
    const report = await cleanupWorldVectors(env, worldId, "orphans");
    if (!report.enabled) return undefined;
    if (!cleanupOk(report)) {
      console.warn("vector cleanup after update incomplete", {
        worldId,
        failed: report.failed,
        incomplete: report.incomplete,
        errors: report.errors,
      });
      await markWorldStale(env, worldId).catch(() => {});
      return report;
    }
    return report.attempted > 0 || report.orphanChunkRows > 0
      ? report
      : undefined;
  } catch (error) {
    console.warn("vector cleanup after update failed", {
      worldId,
      reason: error instanceof Error ? error.name : "unknown",
    });
    await markWorldStale(env, worldId).catch(() => {});
    return {
      enabled: true,
      attempted: 0,
      deleted: 0,
      failed: 1,
      incomplete: false,
      orphanChunkRows: 0,
      errors: ["cleanup: failed"],
    };
  }
}
