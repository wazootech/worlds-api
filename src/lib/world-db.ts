import { createCloudflareWorldsSdk } from "@worlds/cloudflare";
import type { WorldsSdkInterface } from "@worlds/sdk";
import type { Env } from "../env";
import { queryOne } from "./db";
import { EMBEDDING_DIMENSIONS } from "./embeddings/catalog";
import { resolveEmbeddingService } from "./embeddings/service";
import { KEY_CACHE_TTL_MS } from "./embeddings/store";

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
};

type WorldMetadataRow = {
  world_id: string;
  namespace: string;
  embedding_model: string;
  chunk_size: number;
  top_k: number;
  min_score: number;
};

/**
 * Cache SDK instances keyed by world_id plus candidateCount. The search
 * candidate pool is provider-internal but sized per request (D2:
 * max(limit, world.topK)), so worlds configured differently or queried with
 * different limits may hold several SDK instances.
 */
type CachedSdk = { sdk: WorldsSdkInterface; expires?: number };
const sdkCache = new Map<string, CachedSdk>();

function sdkCacheKey(
  worldId: string,
  candidateCount?: number,
  forReindex?: boolean,
): string {
  const base =
    candidateCount === undefined ? worldId : `${worldId}:${candidateCount}`;
  return forReindex ? `${base}:reindex` : base;
}

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
    "SELECT world_id, namespace, embedding_model, chunk_size, top_k, min_score FROM worlds WHERE world_id = ? AND state = 'active'",
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
  };
}

/**
 * Returns a WorldsSdk backed by the single D1 binding, scoped to a specific
 * world via the SDK's native worldId option. The SDK owns all data-plane
 * scoping and schema validation for the shared database.
 *
 * candidateCount sizes the search candidate pool at the SQL level
 * (provider-internal per the hosted search contract, worlds-api#30 D2). Routes
 * pass `max(limit, world.topK)`; omit it for non-search callers, which get the
 * SDK's default (limit 100).
 *
 * The SDK is cached per world_id and candidateCount — initialization (schema
 * check) only runs once per distinct combination per worker lifetime.
 */
export async function getWorldSdk(
  env: Env,
  ref: WorldDatabaseRef,
  candidateCount?: number,
  options: { forReindex?: boolean } = {},
): Promise<WorldsSdkInterface> {
  const key = sdkCacheKey(ref.worldId, candidateCount, options.forReindex);
  const cached = sdkCache.get(key);
  if (cached && (cached.expires === undefined || cached.expires > Date.now())) {
    return cached.sdk;
  }
  sdkCache.delete(key);

  // BYOK embeddings (worlds-api#1). resolveEmbeddingService fails closed and
  // never throws: without the switch, a KEK, an active credential, an
  // allowlisted model, and a ready (non-stale) world it returns undefined and
  // the engine runs keyword-only. Searches with candidateCount are "query"
  // operations for the spend guard; imports and reindex are "index".
  const embeddingService = await resolveEmbeddingService(env, ref, {
    operation: candidateCount !== undefined ? "query" : "index",
    forReindex: options.forReindex,
  });

  const sdk = await createCloudflareWorldsSdk({
    database: env.DB,
    worldId: ref.worldId,
    ...(candidateCount !== undefined && { candidateCount }),
    ...(env.VECTORIZE_INDEX && { vectorize: env.VECTORIZE_INDEX }),
    ...(embeddingService && {
      embeddingService,
      vectorDimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  // Under BYOK an SDK reflects credential/state resolved at build time (an
  // embedder, or its absence), so its cache lifetime is bounded to keep
  // revocation, staleness, and newly-ready worlds effective across isolates
  // (design 2.2: <= 60 s). Without BYOK entries live for the isolate.
  sdkCache.set(key, {
    sdk,
    ...(env.EMBEDDING_PROVIDER === "byok" && {
      expires: Date.now() + KEY_CACHE_TTL_MS,
    }),
  });
  return sdk;
}

/**
 * Clear the SDK cache for a specific world (e.g., after state changes),
 * including candidateCount-suffixed instances (`worldId:20` etc.).
 */
export function clearSdkCacheForWorld(worldId: string): void {
  for (const key of [...sdkCache.keys()]) {
    if (key === worldId || key.startsWith(`${worldId}:`)) {
      sdkCache.delete(key);
    }
  }
}

/** Clear the entire SDK cache (e.g., after schema changes or namespace delete). */
export function clearSdkCache(): void {
  sdkCache.clear();
}
