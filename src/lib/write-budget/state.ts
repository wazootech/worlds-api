import type { Env } from "../../env";

/**
 * Per-namespace daily D1 row-write budget.
 *
 * D1 bills (and, on the free plan, hard-stops at) rows written account-wide,
 * and every world shares one database, so one tenant's writes can exhaust the
 * quota for all of them. Inference multiplies a write: each inferred quad is a
 * row plus an entry in every index.
 *
 * The budget is opt-in: `NAMESPACE_DAILY_ROW_WRITE_BUDGET` unset (or not a
 * positive integer) disables it, unless a namespace has its own override (see
 * namespaceWriteBudget). It is a soft limit. A write is refused once
 * the namespace has already used its budget today (UTC), so a single write can
 * overshoot by its own size.
 */
export function rowWriteBudget(env: Env): number | null {
  const parsed = Number(env.NAMESPACE_DAILY_ROW_WRITE_BUDGET);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Rows written by the data plane in this isolate, not yet stored. */
export const pending = new Map<string, number>();

/**
 * Whether a budget currently applies to a namespace, as last resolved by
 * namespaceWriteBudget. Cached SDKs keep one metered database for life, so the
 * decision to count is made when a write runs, not when the database is built.
 * A namespace not seen yet counts (the safe side).
 */
export const budgetActive = new Map<string, boolean>();

export const OVERRIDE_TTL_MS = 30_000;
export const OVERRIDE_CACHE_MAX = 1000;
/** Per-isolate cache of namespace overrides; `value: null` means none is set. */
export const overrides = new Map<
  string,
  { value: number | null; expires: number }
>();

/** For tests. */
export function resetPendingWriteUsage(): void {
  pending.clear();
  overrides.clear();
  budgetActive.clear();
}
