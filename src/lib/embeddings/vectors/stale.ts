import type { Env } from "../../../env";
import { execute, getDb, now } from "../../db";

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
 * With `modelIds`, only worlds on those models are marked; revoking one
 * provider's key leaves worlds on another provider's key alone.
 */
export async function markNamespaceStale(
  env: Env,
  namespace: string,
  modelIds?: readonly string[],
): Promise<number> {
  if (modelIds && modelIds.length === 0) return 0;
  const result = await execute(
    getDb(env),
    `UPDATE world_embedding_state SET state = 'stale', reindex_cursor = NULL, update_time = ?
      WHERE world_id IN (SELECT world_id FROM worlds WHERE namespace = ?${
        modelIds
          ? ` AND embedding_model IN (${modelIds.map(() => "?").join(",")})`
          : ""
      })`,
    [now(), namespace, ...(modelIds ?? [])],
  );
  return result.rowsAffected;
}
