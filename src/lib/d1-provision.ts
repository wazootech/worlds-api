import type { Env } from "../env";
import { getDb, queryOne, execute, now } from "./db";

/**
 * D1-based world provisioning.
 *
 * With the single-D1 model, "provisioning" a world is just an INSERT into the
 * `worlds` table — no external API calls, no database creation, no token
 * minting. All world data lives in the same D1 database, separated by
 * `world_uid` columns on the per-world tables.
 */

export interface WorldMetadata {
  uid: string;
  namespace: string;
  display_name: string;
  state: string;
  embedding_model: string;
  chunk_size: number;
  top_k: number;
  min_score: number;
  delete_time: string | null;
  expire_time: string | null;
  purge_status: string;
  purged_at: string | null;
  create_time: string;
  update_time: string;
}

/**
 * "Provisions" a new world by inserting its metadata into the worlds table.
 * Returns the created metadata row.
 */
export async function provisionWorld(
  env: Env,
  worldUid: string,
  namespace: string,
  options: {
    displayName?: string;
    embeddingModel?: string;
    chunkSize?: number;
    topK?: number;
    minScore?: number;
  } = {},
): Promise<WorldMetadata> {
  const db = getDb(env);
  const ts = now();
  const displayName = options.displayName ?? worldUid;
  const embeddingModel = options.embeddingModel ?? "tfjs-universal-sentence-encoder";
  const chunkSize = options.chunkSize ?? 1000;
  const topK = options.topK ?? 20;
  const minScore = options.minScore ?? 0.0;

  await execute(
    db,
    `INSERT INTO worlds (uid, namespace, display_name, state, embedding_model, chunk_size, top_k, min_score, create_time, update_time)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
    [worldUid, namespace, displayName, embeddingModel, chunkSize, topK, minScore, ts, ts],
  );

  const row = await queryOne<WorldMetadata>(
    db,
    "SELECT * FROM worlds WHERE uid = ?",
    [worldUid],
  );
  return row!;
}

/**
 * Resolves a world's metadata by uid. Returns null if not found or not active
 * (for data-plane access).
 */
export async function resolveWorld(
  env: Env,
  worldUid: string,
  includeDeleted = false,
): Promise<WorldMetadata | null> {
  const db = getDb(env);
  const sql = includeDeleted
    ? "SELECT * FROM worlds WHERE uid = ? AND state = 'deleted'"
    : "SELECT * FROM worlds WHERE uid = ? AND state != 'deleted'";
  return queryOne<WorldMetadata>(db, sql, [worldUid]);
}
