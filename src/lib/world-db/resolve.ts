import type { Env } from "../../env";
import { queryOne } from "../db";
import type { InferenceSetting } from "../inference";

/**
 * Per-world database reference. With the single-D1 model, there's no separate
 * database URL — all data lives in the same D1 binding, filtered by world_id.
 * The reference carries the world's metadata needed to initialize the SDK.
 */
export type WorldDatabaseRef = {
  worldId: string;
  namespace: string;
  embeddingModel: string;
  chunkSize: number;
  topK: number;
  minScore: number;
  /** Per-world OWL 2 RL inference setting; absent means off. */
  inference?: InferenceSetting;
};

type WorldMetadataRow = {
  world_id: string;
  namespace: string;
  embedding_model: string;
  chunk_size: number;
  top_k: number;
  min_score: number;
  inference_enabled: number | null;
  inference_graphs: string | null;
  inference_max_asserted_quads: number | null;
};

/**
 * Resolves a world's metadata by its canonical world_id. Only worlds in an
 * active state are reachable by the data plane; suspended or deleted worlds
 * resolve to null and routes reject with NOT_FOUND.
 */
export async function resolveWorldDatabase(
  env: Env,
  worldId: string,
): Promise<WorldDatabaseRef | null> {
  const row = await queryOne<WorldMetadataRow>(
    env.DB,
    `SELECT w.world_id, w.namespace, w.embedding_model, w.chunk_size, w.top_k, w.min_score,
            i.enabled AS inference_enabled, i.graphs AS inference_graphs,
            i.max_asserted_quads AS inference_max_asserted_quads
     FROM worlds w LEFT JOIN world_inference i ON i.world_id = w.world_id
     WHERE w.world_id = ? AND w.state = 'active'`,
    [worldId],
  );
  if (!row) return null;
  return {
    worldId: row.world_id,
    namespace: row.namespace,
    embeddingModel: row.embedding_model,
    chunkSize: row.chunk_size,
    topK: row.top_k,
    minScore: row.min_score,
    ...(row.inference_enabled != null && {
      inference: {
        enabled: Number(row.inference_enabled) === 1,
        ...(row.inference_graphs && {
          graphs: row.inference_graphs as "per-graph" | "union",
        }),
        ...(row.inference_max_asserted_quads != null && {
          maxAssertedQuads: Number(row.inference_max_asserted_quads),
        }),
      },
    }),
  };
}
