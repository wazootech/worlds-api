import { createCloudflareWorldsSdk } from "@worlds/cloudflare";
import type { WorldsSdkInterface } from "@worlds/sdk";
import type { Env } from "../env";
import { queryOne } from "./db";
import { WorldScopedD1 } from "./d1-world";

/**
 * Per-world database reference. With the single-D1 model, there's no separate
 * database URL — all data lives in the same D1 binding, filtered by world_uid.
 * The reference carries the world's metadata needed to initialize the SDK.
 */
export type WorldDatabaseRef = {
  worldUid: string;
  namespace: string;
  embeddingModel: string;
  chunkSize: number;
  topK: number;
  minScore: number;
};

type WorldMetadataRow = {
  uid: string;
  namespace: string;
  embedding_model: string;
  chunk_size: number;
  top_k: number;
  min_score: number;
};

/** Cache SDK instances by world_uid (one per active world). */
const sdkCache = new Map<string, WorldsSdkInterface>();

/**
 * Resolves a world's metadata by its canonical world_uid. Only worlds in an
 * active state are reachable by the data plane; suspended or deleted worlds
 * resolve to null and routes reject with NOT_FOUND.
 */
export async function resolveWorldDatabase(
  env: Env,
  worldUid: string,
): Promise<WorldDatabaseRef | null> {
  const row = await queryOne<WorldMetadataRow>(
    env.DB,
    "SELECT uid, namespace, embedding_model, chunk_size, top_k, min_score FROM worlds WHERE uid = ? AND state = 'active'",
    [worldUid],
  );
  if (!row) return null;
  return {
    worldUid: row.uid,
    namespace: row.namespace,
    embeddingModel: row.embedding_model,
    chunkSize: row.chunk_size,
    topK: row.top_k,
    minScore: row.min_score,
  };
}

/**
 * Returns a WorldsSdk backed by the single D1 binding, scoped to a specific
 * world via the WorldScopedD1 wrapper. The wrapper intercepts all D1 queries
 * to inject `world_uid` filtering, giving each world its own isolated view of
 * the shared database.
 *
 * The SDK is cached per world_uid — initialization (schema check) only runs
 * once per world per worker lifetime.
 */
export async function getWorldSdk(
  env: Env,
  ref: WorldDatabaseRef,
): Promise<WorldsSdkInterface> {
  const cached = sdkCache.get(ref.worldUid);
  if (cached) return cached;

  const scopedDb = new WorldScopedD1(env.DB, ref.worldUid);

  const sdk = await createCloudflareWorldsSdk({
    database: scopedDb as any, // D1DatabaseLike structural match
  });

  sdkCache.set(ref.worldUid, sdk);
  return sdk;
}

/** Clear the SDK cache for a specific world (e.g., after state changes). */
export function clearSdkCacheForWorld(worldUid: string): void {
  sdkCache.delete(worldUid);
}

/** Clear the entire SDK cache (e.g., after schema changes or namespace delete). */
export function clearSdkCache(): void {
  sdkCache.clear();
}
