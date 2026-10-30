import { createCloudflareWorldsSdk } from "@worlds/cloudflare";
import { meterDatabase, namespaceWriteBudget } from "./write-budget";
import type { WorldsSdkInterface } from "@worlds/sdk";
import type { Env } from "../env";
import { EMBEDDING_DIMENSIONS } from "./embeddings/catalog";
import { resolveEmbeddingService } from "./embeddings/service";
import { KEY_CACHE_TTL_MS } from "./embeddings/store";
import type { WorldDatabaseRef } from "./world-db/resolve";

export { resolveWorldDatabase } from "./world-db/resolve";
export type { WorldDatabaseRef } from "./world-db/resolve";

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
  options: {
    forReindex?: boolean;
    /**
     * Restricts the SDK to these subjects (windowed reindex). A windowed SDK
     * is built per call and never cached.
     */
    includeSubjects?: string[];
    /** Per-call embed guard override for a windowed reindex. */
    maxUnits?: number;
  } = {},
): Promise<WorldsSdkInterface> {
  // Refresh whether this namespace has a budget (cached 30s) before any work,
  // so a cached SDK's writes are counted or not as the budget stands now.
  await namespaceWriteBudget(env, ref.namespace);
  const windowed = options.includeSubjects !== undefined;
  const key = sdkCacheKey(ref.worldId, candidateCount, options.forReindex);
  if (!windowed) {
    const cached = sdkCache.get(key);
    if (
      cached &&
      (cached.expires === undefined || cached.expires > Date.now())
    ) {
      return cached.sdk;
    }
    sdkCache.delete(key);
  }

  // BYOK embeddings (worlds-api#1). resolveEmbeddingService fails closed and
  // never throws: without the switch, a KEK, an active credential, an
  // allowlisted model, and a ready (non-stale) world it returns undefined and
  // the engine runs keyword-only. Searches with candidateCount are "query"
  // operations for the spend guard; imports and reindex are "index".
  const embeddingService = await resolveEmbeddingService(env, ref, {
    operation: candidateCount !== undefined ? "query" : "index",
    forReindex: options.forReindex,
    maxUnits: options.maxUnits,
  });

  const sdk = await createCloudflareWorldsSdk({
    // Always wrapped: whether a write is counted is decided when it runs, so a
    // budget set after this SDK was cached still applies.
    database: meterDatabase(env.DB, ref.namespace),
    worldId: ref.worldId,
    // Off unless the world opted in. The data plane additionally needs the
    // quads.derived column (a commit fails without it).
    ...(ref.inference?.enabled && { inference: ref.inference }),
    ...(windowed && { include: { subjects: options.includeSubjects } }),
    ...(candidateCount !== undefined && { candidateCount }),
    ...(env.VECTORIZE_INDEX && { vectorize: env.VECTORIZE_INDEX }),
    ...(embeddingService && {
      embeddingService,
      vectorDimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  // An SDK reflects credential/state resolved at build time (an embedder, or
  // its absence), so its cache lifetime is bounded to keep revocation,
  // staleness, and newly-ready worlds effective across isolates (design 2.2:
  // <= 60 s).
  if (windowed) return sdk;
  sdkCache.set(key, {
    sdk,
    expires: Date.now() + KEY_CACHE_TTL_MS,
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
