import type { Env } from "../env";

/**
 * Control-plane database helpers over a single Cloudflare D1 binding.
 *
 * All control-plane tables (worlds, api_keys) live in the same D1 database
 * alongside per-world data (quads, chunks, chunks_fts), separated by a
 * `world_uid` column on per-world tables.
 */

type D1Db = import("@cloudflare/workers-types").D1Database;

/** Returns the D1 binding from the worker environment. */
export function getDb(env: Env): D1Db {
  return env.DB;
}

/** Execute a SELECT and return all matching rows as plain objects. */
export async function query<T>(
  db: D1Db,
  sql: string,
  args?: unknown[],
): Promise<T[]> {
  const stmt =
    args && args.length > 0 ? db.prepare(sql).bind(...args) : db.prepare(sql);
  const result = await stmt.all<Record<string, unknown>>();
  return result.results as unknown as T[];
}

/** Execute a SELECT and return the first row, or null if empty. */
export async function queryOne<T>(
  db: D1Db,
  sql: string,
  args?: unknown[],
): Promise<T | null> {
  const stmt =
    args && args.length > 0 ? db.prepare(sql).bind(...args) : db.prepare(sql);
  const row = await stmt.first<Record<string, unknown>>();
  if (!row) return null;
  return row as unknown as T;
}

/** Execute a non-SELECT statement (INSERT, UPDATE, DELETE) and return rows affected. */
export async function execute(
  db: D1Db,
  sql: string,
  args?: unknown[],
): Promise<{ rowsAffected: number }> {
  const stmt =
    args && args.length > 0 ? db.prepare(sql).bind(...args) : db.prepare(sql);
  const result = await stmt.run();
  return { rowsAffected: result.meta?.changes ?? 0 };
}

/** Generate a random UUID for primary keys. */
export function uid(): string {
  return crypto.randomUUID();
}

/** Return the current time as an ISO 8601 string. */
export function now(): string {
  return new Date().toISOString();
}
