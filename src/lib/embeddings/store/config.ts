import type { Env } from "../../../env";

export type EmbeddingOperation = "index" | "query";

/**
 * Two independent daily pools per namespace (UTC day). The write pool pays for
 * import and reindex; the query pool pays for search-time query embeds. They
 * are separate so read traffic (any data:read world token can search) can
 * never exhaust the pool that import and reindex depend on. Worst-case daily
 * spend is the sum of both pools.
 */
export const DEFAULT_DAILY_BUDGET = 20_000;
export const DEFAULT_DAILY_QUERY_BUDGET = 5_000;
export const DEFAULT_REINDEX_MAX_CHUNKS = 5_000;

export function positiveInt(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Write pool: texts embedded by import and reindex per namespace per day. */
export function dailyBudget(env: Env): number {
  return positiveInt(env.EMBEDDING_DAILY_BUDGET, DEFAULT_DAILY_BUDGET);
}

/** Query pool: search-time query embeds per namespace per day. */
export function dailyQueryBudget(env: Env): number {
  return positiveInt(
    env.EMBEDDING_DAILY_QUERY_BUDGET,
    DEFAULT_DAILY_QUERY_BUDGET,
  );
}

export function poolLimit(env: Env, operation: EmbeddingOperation): number {
  return operation === "query" ? dailyQueryBudget(env) : dailyBudget(env);
}

export function reindexMaxChunks(env: Env): number {
  return positiveInt(
    env.EMBEDDING_REINDEX_MAX_CHUNKS,
    DEFAULT_REINDEX_MAX_CHUNKS,
  );
}
