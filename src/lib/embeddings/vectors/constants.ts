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

export const PAGE_SIZE = 200;
/** Delete batch width sent to Vectorize deleteByIds. */
export const DELETE_BATCH = 100;
/** Pages per invocation: bounds subrequests per Worker request (resumable). */
export const MAX_PAGES = 50;
export const MAX_ERRORS = 5;

export function isMissingTable(error: unknown): boolean {
  return (
    error instanceof Error &&
    /no such table|does not exist/i.test(error.message)
  );
}

export type ChunkRow = {
  chunk_id: number;
  subject: string;
  predicate: string;
  graph: string;
  value: string;
};

export const NO_QUAD =
  "NOT EXISTS (SELECT 1 FROM quads q WHERE q.quad_id = chunks.quad_id AND q.world_id = chunks.world_id)";
