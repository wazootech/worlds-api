import type { Env } from "../../env";

// ---------------------------------------------------------------------------
// Limits (env-configurable, sane defaults)
// ---------------------------------------------------------------------------

export const LIMITS = {
  sparqlTimeoutMs: 5000,
  sparqlMaxQueryLength: 20_000,
  sparqlMaxResults: 1_000,
  maxImportBytes: 5 * 1024 * 1024, // 5 MiB of raw body / serialized data
  maxImportQuads: 10_000,
  rateLimitRpm: 120,
  rateLimitBurst: 60,
} as const;

function intFromEnv(
  env: Env,
  key: keyof typeof LIMITS,
  fallback: number,
  allowZero = false,
) {
  const raw =
    key === "sparqlTimeoutMs"
      ? env.SPARQL_TIMEOUT_MS
      : key === "sparqlMaxQueryLength"
        ? env.SPARQL_MAX_QUERY_LENGTH
        : key === "sparqlMaxResults"
          ? env.SPARQL_MAX_RESULTS
          : key === "maxImportBytes"
            ? env.MAX_IMPORT_BYTES
            : key === "maxImportQuads"
              ? env.MAX_IMPORT_QUADS
              : key === "rateLimitRpm"
                ? env.RATE_LIMIT_RPM
                : env.RATE_LIMIT_BURST;
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  if (parsed === 0 && !allowZero) return fallback;
  return parsed;
}

export function sparqlTimeoutMs(env: Env) {
  return intFromEnv(env, "sparqlTimeoutMs", LIMITS.sparqlTimeoutMs);
}
export function sparqlMaxQueryLength(env: Env) {
  return intFromEnv(env, "sparqlMaxQueryLength", LIMITS.sparqlMaxQueryLength);
}
export function sparqlMaxResults(env: Env) {
  return intFromEnv(env, "sparqlMaxResults", LIMITS.sparqlMaxResults);
}
export function maxImportBytes(env: Env) {
  return intFromEnv(env, "maxImportBytes", LIMITS.maxImportBytes);
}
export function maxImportQuads(env: Env) {
  return intFromEnv(env, "maxImportQuads", LIMITS.maxImportQuads);
}
export function rateLimitRpm(env: Env) {
  // 0 explicitly disables rate limiting (used by tests and local dev).
  return intFromEnv(env, "rateLimitRpm", LIMITS.rateLimitRpm, true);
}
export function rateLimitBurst(env: Env) {
  return intFromEnv(env, "rateLimitBurst", LIMITS.rateLimitBurst);
}
