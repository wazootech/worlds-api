import type { Env } from "../../../env";
import { getDb, now, query, queryOne } from "../../db";
import { poolLimit, type EmbeddingOperation } from "./config";

function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Atomically reserves `units` embeddings from the operation's pool for a
 * namespace today. Returns false (and reserves nothing) when it would exceed
 * that pool's daily limit. Must be called before the provider is contacted;
 * spend is not refunded on provider failure, and every provider retry is a new
 * reservation.
 *
 * One conditional upsert is the whole guard. Success is decided by RETURNING
 * (a row comes back only when the insert or the DO UPDATE branch actually ran)
 * rather than by `meta.changes`, so it does not depend on how D1 counts
 * changes for a conditional upsert whose WHERE is false. Anything that is not
 * a returned row fails closed.
 */
export async function reserveBudget(
  env: Env,
  namespace: string,
  units: number,
  operation: EmbeddingOperation,
): Promise<boolean> {
  if (units <= 0) return true;
  const limit = poolLimit(env, operation);
  if (units > limit) return false;
  const indexUnits = operation === "index" ? units : 0;
  const queryUnits = operation === "query" ? units : 0;
  const pool = operation === "query" ? "query_units" : "index_units";
  const rows = await query<{ units: number }>(
    getDb(env),
    `INSERT INTO embedding_usage (namespace, day, units, index_units, query_units, update_time)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(namespace, day) DO UPDATE SET
       units = units + excluded.units,
       index_units = index_units + excluded.index_units,
       query_units = query_units + excluded.query_units,
       update_time = excluded.update_time
     WHERE ${pool} + excluded.${pool} <= ?
     RETURNING units`,
    [namespace, utcDay(), units, indexUnits, queryUnits, now(), limit],
  );
  return Array.isArray(rows) && rows.length > 0;
}

/** Texts still available today in the write (index) pool; 0 when exhausted. */
export async function remainingBudget(
  env: Env,
  namespace: string,
  operation: EmbeddingOperation = "index",
): Promise<number> {
  const column = operation === "query" ? "query_units" : "index_units";
  const row = await queryOne<{ used: number }>(
    getDb(env),
    `SELECT ${column} AS used FROM embedding_usage WHERE namespace = ? AND day = ?`,
    [namespace, utcDay()],
  );
  return Math.max(0, poolLimit(env, operation) - Number(row?.used ?? 0));
}
