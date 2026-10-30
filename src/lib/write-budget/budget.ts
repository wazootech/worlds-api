import type { Env } from "../../env";
import { execute, getDb, now, queryOne } from "../db";
import {
  budgetActive,
  OVERRIDE_CACHE_MAX,
  OVERRIDE_TTL_MS,
  overrides,
  pending,
  rowWriteBudget,
  utcDay,
} from "./state";

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
