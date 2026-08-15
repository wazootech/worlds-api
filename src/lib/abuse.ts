import type { Env } from "../env";

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

// ---------------------------------------------------------------------------
// Per-key token-bucket rate limiting (in-memory, no external state)
//
// Buckets are keyed by the (SHA-256 hashed) bearer token so each data-plane
// key gets an independent budget. State is per-isolate by design: a
// standalone deployment protects itself without any control-plane
// dependency, and Cloudflare eviction simply resets budgets.
// ---------------------------------------------------------------------------

interface Bucket {
  tokens: number;
  last: number; // last refill timestamp, ms epoch
}

const buckets = new Map<string, Bucket>();
const BUCKET_IDLE_MS = 10 * 60 * 1000;
const MAX_BUCKETS = 10_000;

export type RateLimitDecision =
  { allowed: true } | { allowed: false; retryAfterSeconds: number };

// Sweep is lazy (no timers — Cloudflare Workers forbid module-scope timers):
// when the bucket map grows past a threshold, idle buckets are dropped.
function sweepIdleBuckets(now: number) {
  const cutoff = now - BUCKET_IDLE_MS;
  for (const [key, bucket] of buckets) {
    if (bucket.last < cutoff) buckets.delete(key);
  }
}

export function checkRateLimit(key: string, env: Env): RateLimitDecision {
  const rpm = rateLimitRpm(env);
  if (rpm <= 0) return { allowed: true }; // explicitly disabled

  const burst = rateLimitBurst(env);
  const now = Date.now();

  if (buckets.size >= MAX_BUCKETS) {
    sweepIdleBuckets(now);
  }

  const bucket = buckets.get(key);
  if (!bucket) {
    buckets.set(key, { tokens: Math.max(1, burst), last: now });
    return { allowed: true };
  }

  const elapsedSeconds = (now - bucket.last) / 1000;
  bucket.tokens = Math.min(
    Math.max(1, burst),
    bucket.tokens + (elapsedSeconds * rpm) / 60,
  );
  bucket.last = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true };
  }

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((1 - bucket.tokens) / (rpm / 60)),
  );
  return { allowed: false, retryAfterSeconds };
}

// ---------------------------------------------------------------------------
// CORS origins
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWED_ORIGINS = [
  "https://console.wazoo.dev",
  "https://console-qa.wazoo.dev",
  "http://localhost:3000",
];

/**
 * Tightened CORS: exact-match against the env-configured list, or a curated
 * default that still permits the preview-worker origins used by PR deploys.
 */
export function isOriginAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return false;

  const configured = env.CORS_ORIGINS;
  if (configured) {
    const list = configured
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    return list.includes(origin);
  }

  if (DEFAULT_ALLOWED_ORIGINS.includes(origin)) return true;
  // Cloudflare preview workers: wazoo-console-pr-<n>.ethan-r-davidson.workers.dev
  return (
    origin === "https://ethan-r-davidson.workers.dev" ||
    origin.endsWith(".ethan-r-davidson.workers.dev")
  );
}
