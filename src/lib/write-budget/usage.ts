import type { Env } from "../../env";
import { execute, getDb, now } from "../db";
import { pending, utcDay } from "./state";

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
