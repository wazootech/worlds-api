import { buildSearchResultId } from "@worlds/cloudflare";
import type { Env } from "../../env";
import { execute, getDb, now, query, queryOne } from "../db";
import { describeError } from "./errors";

/**
 * Vector cleanup (design section 7, deletion).
 *
 * Vectorize holds customer chunk text in vector metadata and the shared index
 * has no list API, so vectors can only be deleted by id, and ids can only be
 * recomputed from D1 chunk rows (`buildSearchResultId` over the chunk's
 * subject/predicate/graph/value, world-scoped by VectorizeVectorSearchIndex).
 * Cleanup therefore always runs BEFORE the chunk rows it enumerates are
 * dropped, and it is gated on the Vectorize binding being bound, never on an
 * embedder existing: a revoked credential or a cleared KEK must not stop
 * removed text from leaving the index.
 *
 * Cleanup is best effort at the Vectorize API but never silent: every call
 * returns a report, callers surface it, and a failed or incomplete run leaves
 * the D1 rows that identify the remaining vectors in place so a retry finds
 * them again.
 */

const PAGE_SIZE = 200;
/** Delete batch width sent to Vectorize deleteByIds. */
const DELETE_BATCH = 100;
/** Pages per invocation: bounds subrequests per Worker request (resumable). */
const MAX_PAGES = 50;
const MAX_ERRORS = 5;

/**
 * Physical Vectorize id of a chunk vector.
 *
 * `@worlds/cloudflare` does not export its VectorizeVectorSearchIndex from any
 * public entry point, so this mirrors its private `physicalId`: vectors are
 * namespaced per world (two worlds holding the same text must not share or
 * delete each other's vectors) and, since Vectorize caps ids at 64 bytes,
 * hashed as `v.` + base64url(SHA-256(`${worldId}\u0000${resultId}`)).
 * tests/byok-vector-cleanup.test.ts pins this against the installed package,
 * so an upstream change fails CI instead of silently orphaning vectors.
 */
export async function physicalVectorId(
  worldId: string,
  resultId: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${worldId}\u0000${resultId}`),
  );
  let binary = "";
  for (const byte of new Uint8Array(digest))
    binary += String.fromCharCode(byte);
  const base64Url = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `v.${base64Url}`;
}

export type VectorCleanupReport = {
  /** False when no Vectorize binding is present: nothing to clean. */
  enabled: boolean;
  /** Vector ids enumerated from D1 chunk rows. */
  attempted: number;
  /** Ids Vectorize accepted for deletion. */
  deleted: number;
  /** Ids whose deletion (or enumeration) failed. */
  failed: number;
  /** True when more vectors remain and a re-run is required. */
  incomplete: boolean;
  /** Orphan chunk rows (no quad left) removed from D1. */
  orphanChunkRows: number;
  /** Failure classes only, never provider bodies. */
  errors: string[];
};

export function emptyCleanupReport(enabled: boolean): VectorCleanupReport {
  return {
    enabled,
    attempted: 0,
    deleted: 0,
    failed: 0,
    incomplete: false,
    orphanChunkRows: 0,
    errors: [],
  };
}

export function cleanupOk(report: VectorCleanupReport): boolean {
  return report.failed === 0 && !report.incomplete;
}

export function mergeCleanupReports(
  a: VectorCleanupReport,
  b: VectorCleanupReport,
): VectorCleanupReport {
  return {
    enabled: a.enabled || b.enabled,
    attempted: a.attempted + b.attempted,
    deleted: a.deleted + b.deleted,
    failed: a.failed + b.failed,
    incomplete: a.incomplete || b.incomplete,
    orphanChunkRows: a.orphanChunkRows + b.orphanChunkRows,
    errors: [...new Set([...a.errors, ...b.errors])].slice(0, MAX_ERRORS),
  };
}

function recordError(
  report: VectorCleanupReport,
  stage: string,
  error: unknown,
) {
  const entry = `${stage}: ${describeError(error)}`;
  if (report.errors.length < MAX_ERRORS && !report.errors.includes(entry)) {
    report.errors.push(entry);
  }
}

/** A missing chunks/quads table means the world never indexed anything. */
function isMissingTable(error: unknown): boolean {
  return (
    error instanceof Error &&
    /no such table|does not exist/i.test(error.message)
  );
}

type ChunkRow = {
  chunk_id: number;
  subject: string;
  predicate: string;
  graph: string;
  value: string;
};

const NO_QUAD =
  "NOT EXISTS (SELECT 1 FROM quads q WHERE q.quad_id = chunks.quad_id AND q.world_id = chunks.world_id)";

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

/**
 * Marks a world's embedding state stale (search keyword-only until reindex).
 * Never inserts: a world without a state row already reports stale/unconfigured.
 */
export async function markWorldStale(env: Env, worldId: string): Promise<void> {
  await execute(
    getDb(env),
    "UPDATE world_embedding_state SET state = 'stale', reindex_cursor = NULL, update_time = ? WHERE world_id = ?",
    [now(), worldId],
  );
}

/**
 * Marks worlds of a namespace stale (credential revoke, namespace delete).
 * With `provider`, only worlds whose embedding model belongs to that provider
 * (model ids start `<provider>/`) are marked; revoking one provider's key
 * leaves worlds on another provider's key alone.
 */
export async function markNamespaceStale(
  env: Env,
  namespace: string,
  provider?: string,
): Promise<number> {
  const result = await execute(
    getDb(env),
    `UPDATE world_embedding_state SET state = 'stale', reindex_cursor = NULL, update_time = ?
      WHERE world_id IN (SELECT world_id FROM worlds WHERE namespace = ?${
        provider ? " AND embedding_model LIKE ?" : ""
      })`,
    provider ? [now(), namespace, `${provider}/%`] : [now(), namespace],
  );
  return result.rowsAffected;
}
