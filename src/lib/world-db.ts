import { createCloudflareWorldsSdk } from "@worlds/cloudflare";
import type { WorldsSdkInterface } from "@worlds/sdk";
import type { Env } from "../env";
import { queryOne } from "./db";

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

/**
 * Cache SDK instances keyed by world_uid plus candidateCount. The search
 * candidate pool is provider-internal but sized per request (D2:
 * max(limit, world.topK)), so worlds configured differently or queried with
 * different limits may hold several SDK instances.
 */
const sdkCache = new Map<string, WorldsSdkInterface>();

function sdkCacheKey(worldUid: string, candidateCount?: number): string {
  return candidateCount === undefined
    ? worldUid
    : `${worldUid}:${candidateCount}`;
}

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
 * world via the SDK's native worldUid option. The SDK owns all data-plane
 * scoping and schema validation for the shared database.
 *
 * candidateCount sizes the search candidate pool at the SQL level
 * (provider-internal per the hosted search contract, worlds-api#30 D2). Routes
 * pass `max(limit, world.topK)`; omit it for non-search callers, which get the
 * SDK's default (limit 100).
 *
 * The SDK is cached per world_uid and candidateCount — initialization (schema
 * check) only runs once per distinct combination per worker lifetime.
 */
export async function getWorldSdk(
  env: Env,
  ref: WorldDatabaseRef,
  candidateCount?: number,
): Promise<WorldsSdkInterface> {
  const key = sdkCacheKey(ref.worldUid, candidateCount);
  const cached = sdkCache.get(key);
  if (cached) return cached;

  const sdk = await createCloudflareWorldsSdk({
    database: env.DB,
    worldUid: ref.worldUid,
    ...(candidateCount !== undefined && { candidateCount }),
  });

  sdkCache.set(key, sdk);
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
