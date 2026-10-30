import type { Env } from "../../env";
import { rateLimitBurst, rateLimitRpm } from "./limits";

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
  | { allowed: true }
  | {
      allowed: false;
      retryAfterSeconds: number;
    };

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
