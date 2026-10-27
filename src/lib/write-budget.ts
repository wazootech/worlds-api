import type { Env } from "../env";
import { execute, getDb, now, queryOne } from "./db";

type D1Database = import("@cloudflare/workers-types").D1Database;

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

function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Rows written by the data plane in this isolate, not yet stored. */
const pending = new Map<string, number>();

/** Rows a namespace has written today, as stored plus this isolate's pending. */
export async function rowsWrittenToday(
  env: Env,
  namespace: string,
): Promise<number> {
  const row = await queryOne<{ rows_written: number }>(
    getDb(env),
    "SELECT rows_written FROM namespace_write_usage WHERE namespace = ? AND day = ?",
    [namespace, utcDay()],
  );
  return Number(row?.rows_written ?? 0) + (pending.get(namespace) ?? 0);
}

/**
 * Whether a budget currently applies to a namespace, as last resolved by
 * namespaceWriteBudget. Cached SDKs keep one metered database for life, so the
 * decision to count is made when a write runs, not when the database is built.
 * A namespace not seen yet counts (the safe side).
 */
const budgetActive = new Map<string, boolean>();

const OVERRIDE_TTL_MS = 30_000;
const OVERRIDE_CACHE_MAX = 1000;
/** Per-isolate cache of namespace overrides; `value: null` means none is set. */
const overrides = new Map<string, { value: number | null; expires: number }>();

/**
 * namespaceWriteBudget is the daily row budget that applies to a namespace: its
 * stored override (set by the platform from the customer's plan) or, without
 * one, the `NAMESPACE_DAILY_ROW_WRITE_BUDGET` default. Null means no budget. A
 * failed lookup falls back to the default, so a counter problem cannot take the
 * data plane down. Overrides are cached for 30 seconds per isolate.
 */
export async function namespaceWriteBudget(
  env: Env,
  namespace: string,
): Promise<number | null> {
  const fallback = rowWriteBudget(env);
  const resolved = (value: number | null) => {
    const effective = value ?? fallback;
    if (budgetActive.size >= OVERRIDE_CACHE_MAX) budgetActive.clear();
    budgetActive.set(namespace, effective !== null);
    return effective;
  };
  const hit = overrides.get(namespace);
  if (hit && hit.expires > Date.now()) return resolved(hit.value);
  try {
    const row = await queryOne<{ daily_rows: number }>(
      getDb(env),
      "SELECT daily_rows FROM namespace_write_budget WHERE namespace = ?",
      [namespace],
    );
    const value = row ? Number(row.daily_rows) : null;
    if (overrides.size >= OVERRIDE_CACHE_MAX) overrides.clear();
    overrides.set(namespace, { value, expires: Date.now() + OVERRIDE_TTL_MS });
    return resolved(value);
  } catch (error) {
    console.warn("write budget override lookup failed; using the default", {
      error,
    });
    return resolved(null);
  }
}

/** Stores (or, with null, clears) a namespace's daily row budget override. */
export async function setNamespaceWriteBudget(
  env: Env,
  namespace: string,
  dailyRows: number | null,
): Promise<void> {
  if (dailyRows === null) {
    await execute(
      getDb(env),
      "DELETE FROM namespace_write_budget WHERE namespace = ?",
      [namespace],
    );
  } else {
    await execute(
      getDb(env),
      `INSERT INTO namespace_write_budget (namespace, daily_rows, update_time)
       VALUES (?, ?, ?)
       ON CONFLICT(namespace) DO UPDATE SET
         daily_rows = excluded.daily_rows,
         update_time = excluded.update_time`,
      [namespace, dailyRows, now()],
    );
  }
  overrides.delete(namespace);
  budgetActive.delete(namespace);
}

/**
 * writeBudgetRefusal returns the 429 body when the namespace has already used
 * its budget today, or null when the write may go ahead (budget off, or not yet
 * used). Check it before running a write. A failed usage lookup fails open.
 */
export async function writeBudgetRefusal(
  env: Env,
  namespace: string,
): Promise<ReturnType<typeof writeBudgetError> | null> {
  const budget = await namespaceWriteBudget(env, namespace);
  if (budget === null) return null;
  try {
    return (await rowsWrittenToday(env, namespace)) >= budget
      ? writeBudgetError(budget)
      : null;
  } catch (error) {
    console.warn("write budget lookup failed; allowing the write", { error });
    return null;
  }
}

/** The 429 body for an exhausted budget. */
export function writeBudgetError(budget: number) {
  return {
    error: {
      code: "WRITE_BUDGET_EXCEEDED",
      message: `This namespace has used its daily database write budget (${budget} rows). It resets at 00:00 UTC. Reads still work.`,
    },
  };
}

type Statement = ReturnType<D1Database["prepare"]>;

function rowsWritten(result: unknown): number {
  const meta = (result as { meta?: { rows_written?: number } } | null)?.meta;
  return Number(meta?.rows_written ?? 0);
}

/**
 * meterDatabase wraps the D1 binding the data plane uses and adds up the
 * `meta.rows_written` of everything it executes (index writes included) under
 * the namespace. flushWriteUsage stores the totals.
 */
export function meterDatabase(db: D1Database, namespace: string): D1Database {
  const add = (rows: number) => {
    if (rows > 0 && budgetActive.get(namespace) !== false) {
      pending.set(namespace, (pending.get(namespace) ?? 0) + rows);
    }
  };
  const real = new WeakMap<object, Statement>();
  const wrap = (statement: Statement): Statement => {
    const wrapped = {
      bind: (...values: unknown[]) => wrap(statement.bind(...values)),
      all: async () => {
        const result = await statement.all();
        add(rowsWritten(result));
        return result;
      },
      run: async () => {
        const result = await statement.run();
        add(rowsWritten(result));
        return result;
      },
      first: (...args: unknown[]) =>
        (statement.first as (...a: unknown[]) => unknown)(...args),
      raw: (...args: unknown[]) =>
        (statement.raw as (...a: unknown[]) => unknown)(...args),
    } as unknown as Statement;
    real.set(wrapped as object, statement);
    return wrapped;
  };
  return {
    prepare: (sql: string) => wrap(db.prepare(sql)),
    batch: async (statements: Statement[]) => {
      const results = await db.batch(
        statements.map((s) => real.get(s as object) ?? s),
      );
      for (const result of results) add(rowsWritten(result));
      return results;
    },
    exec: (sql: string) => db.exec(sql),
    dump: () => db.dump(),
  } as unknown as D1Database;
}

/**
 * flushWriteUsage stores what this isolate counted, one atomic upsert per
 * namespace. It never throws: a counter failure must not fail a request whose
 * data is already written. Counts stay in memory when the store fails and the
 * next flush retries them.
 */
export async function flushWriteUsage(env: Env): Promise<void> {
  if (pending.size === 0) return;
  const day = utcDay();
  for (const [namespace, rows] of [...pending]) {
    try {
      await execute(
        getDb(env),
        `INSERT INTO namespace_write_usage (namespace, day, rows_written, update_time)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(namespace, day) DO UPDATE SET
           rows_written = rows_written + excluded.rows_written,
           update_time = excluded.update_time`,
        [namespace, day, rows, now()],
      );
      const left = (pending.get(namespace) ?? 0) - rows;
      if (left <= 0) pending.delete(namespace);
      else pending.set(namespace, left);
    } catch (error) {
      console.warn("write usage flush failed", { namespace, error });
    }
  }
}

/** For tests. */
export function resetPendingWriteUsage(): void {
  pending.clear();
  overrides.clear();
  budgetActive.clear();
}
