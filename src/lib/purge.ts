import type { Env } from "../env";
import { execute, getDb, now, query } from "./db";
import { databaseName, destroyWorldDatabase } from "./turso";

/**
 * Sweeps soft-deleted worlds whose 30-day grace period has elapsed: destroys
 * their Turso database (which also invalidates every token minted against it)
 * and marks the row purged. Bounded and idempotent — a world whose destroy
 * fails is not marked purged and is retried on the next sweep.
 */
export async function runPurgeSweep(
  env: Env,
  limit = 100,
): Promise<{ purged: number; failed: number }> {
  const db = getDb(env);
  const rows = await query<{ uid: string }>(
    db,
    "SELECT uid FROM worlds_metadata WHERE state = 'deleted' AND purge_status != 'purged' AND expire_time IS NOT NULL AND expire_time <= ? ORDER BY expire_time ASC LIMIT ?",
    [now(), limit],
  );

  let purged = 0;
  let failed = 0;
  for (const row of rows) {
    const name = databaseName(env.WAZOO_ENV ?? "prod", row.uid);
    try {
      await destroyWorldDatabase(env, name);
      await execute(
        db,
        "UPDATE worlds_metadata SET purge_status = 'purged', purged_at = ? WHERE uid = ?",
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
