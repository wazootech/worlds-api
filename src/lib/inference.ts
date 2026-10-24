import type { Env } from "../env";
import { execute, getDb, now, query, queryOne } from "./db";

/**
 * Per-world OWL 2 RL inference setting (control plane). Mirrors the data-plane
 * `InferenceOptions` of @worlds/cloudflare. A world with no row has inference
 * off, so the setting is additive: existing worlds and databases are unchanged.
 */
export interface InferenceSetting {
  enabled: boolean;
  graphs?: "per-graph" | "union";
  maxAssertedQuads?: number;
}

type InferenceRow = {
  enabled: number;
  graphs: string | null;
  max_asserted_quads: number | null;
};

function fromRow(row: InferenceRow): InferenceSetting {
  return {
    enabled: Number(row.enabled) === 1,
    ...(row.graphs && { graphs: row.graphs as "per-graph" | "union" }),
    ...(row.max_asserted_quads != null && {
      maxAssertedQuads: Number(row.max_asserted_quads),
    }),
  };
}

/** Returns the world's inference setting, or null when it was never set. */
export async function getInferenceSetting(
  env: Env,
  worldId: string,
): Promise<InferenceSetting | null> {
  const row = await queryOne<InferenceRow>(
    getDb(env),
    "SELECT enabled, graphs, max_asserted_quads FROM world_inference WHERE world_id = ?",
    [worldId],
  );
  return row ? fromRow(row) : null;
}

/**
 * Returns settings for every listed (non-deleted) world, optionally limited to
 * one namespace, keyed by world_id. Worlds with no row are absent.
 */
export async function loadInferenceSettings(
  env: Env,
  namespace?: string,
): Promise<Map<string, InferenceSetting>> {
  const rows = await query<InferenceRow & { world_id: string }>(
    getDb(env),
    `SELECT world_id, enabled, graphs, max_asserted_quads FROM world_inference
     WHERE world_id IN (SELECT world_id FROM worlds WHERE state != 'deleted'${
       namespace === undefined ? "" : " AND namespace = ?"
     })`,
    namespace === undefined ? [] : [namespace],
  );
  return new Map((rows ?? []).map((row) => [row.world_id, fromRow(row)]));
}

/** Replaces the world's inference setting. */
export async function setInferenceSetting(
  env: Env,
  worldId: string,
  setting: InferenceSetting,
): Promise<void> {
  await execute(
    getDb(env),
    `INSERT INTO world_inference (world_id, enabled, graphs, max_asserted_quads, update_time)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(world_id) DO UPDATE SET
       enabled = excluded.enabled, graphs = excluded.graphs,
       max_asserted_quads = excluded.max_asserted_quads,
       update_time = excluded.update_time`,
    [
      worldId,
      setting.enabled ? 1 : 0,
      setting.graphs ?? null,
      setting.maxAssertedQuads ?? null,
      now(),
    ],
  );
}
