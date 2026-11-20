import type { Env } from "../env";
import { execute, getDb, now, queryOne } from "./db";

/**
 * Time-limited pause state (wazoo-api#22). A pause is a self-service,
 * mandatory-duration suspension of a world. The worlds table keeps the coarse
 * state ('paused'); this table carries the expiry. A separate table (rather
 * than a new column on worlds) keeps CONTROL_PLANE_DDL applyable with the
 * existing CREATE TABLE IF NOT EXISTS mechanism — no ALTER, no reset.
 */
export const MIN_PAUSE_SECONDS = 60;
export const MAX_PAUSE_SECONDS = 30 * 24 * 60 * 60; // 30 days

/** Records (or replaces) the pause deadline for a world. Awaited by callers. */
export async function setPauseUntil(
  env: Env,
  worldId: string,
  pauseUntil: string,
): Promise<void> {
  await execute(
    getDb(env),
    `INSERT INTO world_pause_state (world_id, pause_until) VALUES (?, ?)
     ON CONFLICT(world_id) DO UPDATE SET pause_until = excluded.pause_until`,
    [worldId, pauseUntil],
  );
}

/** Removes the pause deadline row, if any. Awaited by callers. */
export async function clearPause(env: Env, worldId: string): Promise<void> {
  await execute(
    getDb(env),
    "DELETE FROM world_pause_state WHERE world_id = ?",
    [worldId],
  );
}

/** Returns the pause deadline for a world, or null when it is not paused. */
export async function getPauseUntil(
  env: Env,
  worldId: string,
): Promise<string | null> {
  const row = await queryOne<{ pause_until: string }>(
    getDb(env),
    "SELECT pause_until FROM world_pause_state WHERE world_id = ?",
    [worldId],
  );
  return row?.pause_until ?? null;
}

/**
 * Flips expired pauses back to active and drops their deadline rows. Runs on
 * the daily cron; between expiry and the sweep, resolveWorldDatabase treats an
 * expired pause as reachable so enforcement never lags behind the deadline.
 * Returns the number of worlds auto-resumed.
 */
export async function runPauseSweep(env: Env): Promise<number> {
  const t = now();
  const result = await execute(
    getDb(env),
    `UPDATE worlds SET state = 'active', update_time = ?
     WHERE state = 'paused' AND NOT EXISTS (
       SELECT 1 FROM world_pause_state p
       WHERE p.world_id = worlds.world_id AND p.pause_until > ?
     )`,
    [t, t],
  );
  await execute(
    getDb(env),
    "DELETE FROM world_pause_state WHERE pause_until <= ?",
    [t],
  );
  return result.rowsAffected;
}
