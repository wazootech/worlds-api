import type { D1Database } from "@cloudflare/workers-types";

/** Rows removed per DELETE statement; keeps each D1 statement small. */
export const PURGE_ROW_BATCH = 500;
/** Delete rounds one sweep may spend across all worlds (bounds subrequests). */
export const PURGE_BATCHES_PER_SWEEP = 100;

export type PurgeBudget = { batches: number };

/** One bounded DELETE per table; each returns when its table is drained. */
const BATCHED_DELETES = [
  // chunks_fts rows go with them through the chunks_ad trigger.
  "DELETE FROM chunks WHERE chunk_id IN (SELECT chunk_id FROM chunks WHERE world_id = ? LIMIT ?)",
  "DELETE FROM quads WHERE rowid IN (SELECT rowid FROM quads WHERE world_id = ? LIMIT ?)",
] as const;

const missingTable = (error: unknown) =>
  /no such table/i.test(error instanceof Error ? error.message : String(error));

/**
 * Deletes a purged world's rows from the shared D1: quads, chunks (and their
 * FTS entries) in bounded batches, then the world's inference setting and
 * embedding state. Idempotent. Returns true once nothing is left; false when
 * `budget` ran out first, so the caller leaves the world pending and the next
 * sweep continues. Throws on a D1 error so the world is retried too.
 */
export async function deleteWorldData(
  db: D1Database,
  worldId: string,
  budget: PurgeBudget,
): Promise<boolean> {
  for (const sql of BATCHED_DELETES) {
    for (;;) {
      if (budget.batches <= 0) return false;
      budget.batches--;
      let changes: number;
      try {
        const res = await db.prepare(sql).bind(worldId, PURGE_ROW_BATCH).run();
        changes = res.meta?.changes ?? 0;
      } catch (error) {
        // A deployment that never created the data plane has nothing to erase.
        if (missingTable(error)) break;
        throw error;
      }
      if (changes < PURGE_ROW_BATCH) break;
    }
  }
  for (const table of ["world_inference", "world_embedding_state"]) {
    await db
      .prepare(`DELETE FROM ${table} WHERE world_id = ?`)
      .bind(worldId)
      .run();
  }
  return true;
}
