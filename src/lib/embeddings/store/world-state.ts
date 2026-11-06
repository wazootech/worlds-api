import type { Env } from "../../../env";
import { execute, getDb, now, queryOne } from "../../db";
import { isAllowlistedEmbeddingModel } from "../catalog";
import { currentKek } from "../envelope";
import type { CredentialStatus } from "./credential-types";

export type WorldEmbeddingStateValue = "stale" | "partial" | "ready";

export type EmbeddingStatus =
  "unconfigured" | "no_credential" | "invalid" | "stale" | "partial" | "ready";

export type WorldState = {
  state: WorldEmbeddingStateValue;
  model: string;
  /** Last subject a windowed reindex finished; null outside a multi-call pass. */
  reindex_cursor: string | null;
};

export async function getWorldState(
  env: Env,
  worldId: string,
): Promise<WorldState | null> {
  return queryOne<WorldState>(
    getDb(env),
    "SELECT state, model, reindex_cursor FROM world_embedding_state WHERE world_id = ?",
    [worldId],
  );
}

/**
 * Upserts a world's state. `cursor` is the windowed-reindex resume point and is
 * cleared (NULL) unless given, so any state change that is not a reindex
 * window (model change, revoke, completion) ends an in-progress pass.
 */
export async function setWorldState(
  env: Env,
  worldId: string,
  state: WorldEmbeddingStateValue,
  model: string,
  cursor: string | null = null,
): Promise<void> {
  await execute(
    getDb(env),
    `INSERT INTO world_embedding_state (world_id, state, model, update_time, reindex_cursor)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(world_id) DO UPDATE SET
       state = excluded.state, model = excluded.model,
       update_time = excluded.update_time, reindex_cursor = excluded.reindex_cursor`,
    [worldId, state, model, now(), cursor],
  );
}

/**
 * A write path (import) could not embed some chunks: a world that claimed
 * `ready` now has chunks without vectors, so it reports `partial` (keyword
 * still covers them) until a reindex repairs it. Never touches other states.
 */
export async function markWorldPartial(
  env: Env,
  worldId: string,
): Promise<void> {
  await execute(
    getDb(env),
    "UPDATE world_embedding_state SET state = 'partial', update_time = ? WHERE world_id = ? AND state = 'ready'",
    [now(), worldId],
  );
}

/** Pure status derivation; see design section 5 for the vocabulary. */
export function computeEmbeddingStatus(input: {
  enabled: boolean;
  model: string;
  credentialStatus: CredentialStatus | undefined;
  state: { state: WorldEmbeddingStateValue; model: string } | undefined;
}): EmbeddingStatus {
  if (!input.enabled || !isAllowlistedEmbeddingModel(input.model)) {
    return "unconfigured";
  }
  if (!input.credentialStatus || input.credentialStatus === "revoked") {
    return "no_credential";
  }
  if (input.credentialStatus === "invalid") return "invalid";
  const { state } = input;
  if (!state || state.model !== input.model || state.state === "stale") {
    return "stale";
  }
  return state.state;
}

/** True when this deployment can run BYOK embeddings at all: a usable KEK is configured. */
export async function byokEnabled(env: Env): Promise<boolean> {
  return (await currentKek(env)) !== null;
}
