import type { Env } from "../env";
import { execute, getDb, now, query } from "./db";

/**
 * Sweeps soft-deleted worlds whose 30-day grace period has elapsed and marks
 * them purged. With the single-D1 model, there's no external database to
 * destroy — purging is just marking the metadata row.
 *
 * The quads/chunks for purged worlds are cleaned up by a separate garbage
 * collection pass (or can be left for D1's built-in cleanup).
 */
export async function runPurgeSweep(
  env: Env,
  limit = 100,
): Promise<{ purged: number; failed: number }> {
  const db = getDb(env);
  const rows = await query<{ uid: string }>(
    db,
    "SELECT uid FROM worlds WHERE state = 'deleted' AND purge_status != 'purged' AND expire_time IS NOT NULL AND expire_time <= ? ORDER BY expire_time ASC LIMIT ?",
    [now(), limit],
  );

  let purged = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await execute(
        db,
        "UPDATE worlds SET purge_status = 'purged', purged_at = ? WHERE uid = ?",
        [now(), row.uid],
      );
      purged++;
    } catch (err) {
      failed++;
      console.error(
        `purge failed for ${row.uid}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return { purged, failed };
}
