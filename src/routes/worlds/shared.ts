import type { Env } from "../../env";
import { getDb, queryOne } from "../../lib/db";
import {
  authorize,
  forbidden,
  forbiddenScope,
  hasScope,
  unauthorized,
} from "../../lib/auth";
import type { InferenceSetting } from "../../lib/inference";
import {
  loadEmbeddingStatuses,
  type EmbeddingStatus,
} from "../../lib/embeddings/store";

export const GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export interface WorldRow {
  world_id: string;
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

export function worldResource(
  row: WorldRow,
  embeddingStatus: EmbeddingStatus,
  inference?: InferenceSetting | null,
) {
  return {
    id: row.world_id,
    displayName: row.display_name,
    state: row.state,
    storage: "d1" as const,
    embeddingModel: row.embedding_model,
    embeddingStatus,
    chunkSize: row.chunk_size,
    topK: row.top_k,
    minScore: row.min_score,
    createTime: row.create_time,
    ...(inference && { inference }),
    updateTime: row.update_time,
    deleteTime: row.delete_time ?? undefined,
    expireTime: row.expire_time ?? undefined,
  };
}

export async function resolveWorldRow(
  db: ReturnType<typeof getDb>,
  worldId: string,
  deleted = false,
): Promise<WorldRow | null> {
  return queryOne<WorldRow>(
    db,
    deleted
      ? "SELECT * FROM worlds WHERE world_id = ? AND state = 'deleted'"
      : "SELECT * FROM worlds WHERE world_id = ? AND state != 'deleted'",
    [worldId],
  );
}

export async function statusFor(
  env: Env,
  row: WorldRow,
): Promise<EmbeddingStatus> {
  const statuses = await loadEmbeddingStatuses(env, [row]);
  return statuses.get(row.world_id) ?? "unconfigured";
}

export function requireWorldAccess(
  auth: Awaited<ReturnType<typeof authorize>>,
  row: WorldRow,
  worldId: string,
  requiredScope?: string,
): Response | null {
  if (auth.admin) return null;
  if (!auth.namespace || auth.namespace !== row.namespace) {
    return unauthorized();
  }
  if (auth.worldId && auth.worldId !== worldId) return forbidden();
  if (requiredScope && !hasScope(auth, requiredScope)) {
    return forbiddenScope(requiredScope);
  }
  return null;
}
