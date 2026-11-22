import type { WorldEmbeddingStateValue } from "../../lib/embeddings/store";

type Previous = { state: WorldEmbeddingStateValue } | null;

/**
 * The embedding state to record when a reindex pass did not finish cleanly,
 * given how many vectors it still upserted (0 when the embedder threw). It
 * never returns `ready`. A windowed pass keeps its cursor, so the next call
 * retries the same window and never re-embeds the windows already finished.
 */
export function stateAfterFailedReindex(
  previous: Previous,
  windowed: boolean,
  upserted: number,
): WorldEmbeddingStateValue {
  if (!windowed) return upserted > 0 ? "partial" : "stale";
  const live = previous?.state === "ready" || previous?.state === "partial";
  if (!live) return "stale";
  return upserted > 0 ? "partial" : previous.state;
}
