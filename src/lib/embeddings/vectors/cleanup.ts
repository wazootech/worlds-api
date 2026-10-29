import { buildSearchResultId } from "@worlds/cloudflare";
import type { Env } from "../../../env";
import { execute, getDb, query, queryOne } from "../../db";
import {
  DELETE_BATCH,
  isMissingTable,
  MAX_PAGES,
  NO_QUAD,
  PAGE_SIZE,
  type ChunkRow,
} from "./constants";
import { physicalVectorId } from "./physical-id";
import {
  emptyCleanupReport,
  recordError,
  type VectorCleanupReport,
} from "./report";

/**
 * Deletes the Vectorize vectors of a world, enumerated from D1 chunk rows that
 * carry a vector.
 *
 * - `all`: every vector of the world (world purge, namespace delete).
 *   Successfully deleted rows have their `vector` column cleared so the run is
 *   resumable and D1 never claims a vector that is gone.
 * - `orphans`: only chunk rows whose quad no longer exists. The Worlds SDK
 *   (`@worlds/cloudflare@0.10.0`) deletes quads on a patch/SPARQL delete but
 *   leaves their chunk rows (and vectors) behind; those rows are removed here
 *   after their vectors are gone, which also stops keyword search from
 *   returning deleted text.
 *
 * Any caller that drops a world's chunk rows wholesale must run `all` cleanup
 * FIRST, because those rows are the only record of the vector ids. The SDK's
 * replace-mode import wipe (`executeReplaceImportWipe`: `DELETE FROM chunks`)
 * does exactly that with no Vectorize handling, so a future import that passes
 * `mode: "replace"` would orphan every vector in the world beyond the reach of
 * this function. No route does that today: `ImportRequest.mode` defaults to
 * "merge" and worlds-api never sets it.
 */
export async function cleanupWorldVectors(
  env: Env,
  worldId: string,
  mode: "all" | "orphans",
): Promise<VectorCleanupReport> {
  const index = env.VECTORIZE_INDEX;
  const report = emptyCleanupReport(Boolean(index));
  if (!index) return report;

  const db = getDb(env);

  // Only worlds that ever had embedding state can have vectors: every path
  // that writes a vector (import/reindex under BYOK) requires or records a
  // world_embedding_state row. Gating on that row keeps worlds that never used
  // BYOK entirely untouched (no chunk scans), while still cleaning worlds
  // whose credential was revoked or whose KEK/provider switch was removed.
  try {
    const known = await queryOne<{ n: number }>(
      db,
      "SELECT 1 AS n FROM world_embedding_state WHERE world_id = ?",
      [worldId],
    );
    if (!known) return report;
  } catch (error) {
    if (isMissingTable(error)) return report;
    report.failed += 1;
    recordError(report, "state", error);
    return report;
  }

  const orphanFilter = mode === "orphans" ? ` AND ${NO_QUAD}` : "";

  let after = 0;
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) {
      report.incomplete = true;
      return report;
    }
    let rows: ChunkRow[];
    try {
      rows =
        (await query<ChunkRow>(
          db,
          `SELECT chunk_id, subject, predicate, graph, value FROM chunks
            WHERE world_id = ? AND vector IS NOT NULL AND chunk_id > ?${orphanFilter}
            ORDER BY chunk_id LIMIT ${PAGE_SIZE}`,
          [worldId, after],
        )) ?? [];
    } catch (error) {
      if (isMissingTable(error)) return report;
      report.failed += 1;
      recordError(report, "enumerate", error);
      return report;
    }
    if (rows.length === 0) break;
    after = rows[rows.length - 1]!.chunk_id;

    const ids = await Promise.all(
      rows.map(async (row) =>
        physicalVectorId(
          worldId,
          await buildSearchResultId({
            subject: row.subject,
            predicate: row.predicate,
            graph: row.graph,
            text: row.value,
          }),
        ),
      ),
    );
    report.attempted += ids.length;
    try {
      for (let i = 0; i < ids.length; i += DELETE_BATCH) {
        await index.deleteByIds(ids.slice(i, i + DELETE_BATCH));
      }
    } catch (error) {
      // Keep the D1 rows: they are the only way to find these ids again.
      report.failed += ids.length;
      recordError(report, "delete", error);
      return report;
    }
    report.deleted += ids.length;

    const placeholders = rows.map(() => "?").join(",");
    const chunkIds = rows.map((row) => row.chunk_id);
    try {
      await execute(
        db,
        mode === "orphans"
          ? `DELETE FROM chunks WHERE chunk_id IN (${placeholders})`
          : `UPDATE chunks SET vector = NULL WHERE chunk_id IN (${placeholders})`,
        chunkIds,
      );
    } catch (error) {
      // Vectors are gone; a retry just re-deletes the same ids.
      report.failed += rows.length;
      recordError(report, "reconcile", error);
      return report;
    }
    if (rows.length < PAGE_SIZE) break;
  }

  if (mode === "orphans") {
    try {
      const removed = await execute(
        db,
        `DELETE FROM chunks WHERE world_id = ? AND ${NO_QUAD}`,
        [worldId],
      );
      report.orphanChunkRows = removed.rowsAffected;
    } catch (error) {
      if (!isMissingTable(error)) {
        report.failed += 1;
        recordError(report, "orphans", error);
      }
    }
  }
  return report;
}
