import type { Env } from "../env";
import { execute, getDb, now, query } from "./db";
import { deleteWorldData, PURGE_BATCHES_PER_SWEEP } from "./purge-data";
import { cleanupOk, cleanupWorldVectors } from "./embeddings/vectors";

/**
 * Sweeps soft-deleted worlds whose 30-day grace period has elapsed and marks
 * them purged. With the single-D1 model, there's no external database to
 * destroy — purging is just marking the metadata row.
 *
 * Before marking a world purged the sweep deletes its vectors, then its quads,
 * chunks (with FTS entries), inference setting and embedding state, in bounded
 * batches. A world with rows left, or any failure, stays pending and is
 * retried by the next sweep.
 */
export async function runPurgeSweep(
  env: Env,
  limit = 100,
): Promise<{ purged: number; failed: number }> {
  const db = getDb(env);
  const rows = await query<{ world_id: string }>(
    db,
    "SELECT world_id FROM worlds WHERE state = 'deleted' AND purge_status != 'purged' AND expire_time IS NOT NULL AND expire_time <= ? ORDER BY expire_time ASC LIMIT ?",
    [now(), limit],
  );

  let purged = 0;
  let failed = 0;
  const budget = { batches: PURGE_BATCHES_PER_SWEEP };
  for (const row of rows) {
    if (budget.batches <= 0) break; // the rest wait for the next sweep
    try {
      // Remove the world's vectors (their metadata holds chunk text) before
      // marking it purged. A failed or incomplete cleanup leaves the world
      // pending so the next sweep retries it, and counts as failed.
      const cleanup = await cleanupWorldVectors(env, row.world_id, "all");
      if (!cleanupOk(cleanup)) {
        failed++;
        console.error(
          `purge deferred for ${row.world_id}: vector cleanup incomplete (${cleanup.errors.join("; ") || "more vectors remain"})`,
        );
        continue;
      }
      if (!(await deleteWorldData(db, row.world_id, budget))) {
        console.warn(`purge continues next sweep for ${row.world_id}`);
        continue;
      }
      await execute(
        db,
        "UPDATE worlds SET purge_status = 'purged', purged_at = ? WHERE world_id = ?",
        [now(), row.world_id],
      );
      purged++;
    } catch (err) {
      failed++;
      console.error(
        `purge failed for ${row.world_id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return { purged, failed };
}
