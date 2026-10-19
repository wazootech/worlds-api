import type { Env } from "../../env";
import { execute, getDb, now, query, queryOne, uid } from "../db";
import { sha256Hex } from "../crypto";
import {
  isAllowlistedEmbeddingModel,
  type EmbeddingProviderId,
} from "./catalog";
export { EMBEDDING_STATUSES } from "./catalog";
import {
  credentialAad,
  currentKek,
  kekForVersion,
  openKey,
  sealKey,
} from "./envelope";
import { describeError } from "./errors";
import { markNamespaceStale } from "./vectors";

export type CredentialStatus = "active" | "invalid" | "revoked";

export type CredentialRow = {
  credential_id: string;
  namespace: string;
  provider: string;
  ciphertext: string | null;
  iv: string | null;
  kek_version: number;
  fingerprint: string;
  last4: string;
  status: CredentialStatus;
  consecutive_auth_failures: number;
  create_time: string;
  rotate_time: string | null;
  revoke_time: string | null;
};

/** Consecutive provider 401/403 results before a credential is marked invalid. */
export const AUTH_FAILURE_THRESHOLD = 3;

/**
 * Two independent daily pools per namespace (UTC day). The write pool pays for
 * import and reindex; the query pool pays for search-time query embeds. They
 * are separate so read traffic (any data:read world token can search) can
 * never exhaust the pool that import and reindex depend on. Worst-case daily
 * spend is the sum of both pools.
 */
export const DEFAULT_DAILY_BUDGET = 20_000;
export const DEFAULT_DAILY_QUERY_BUDGET = 5_000;
export const DEFAULT_REINDEX_MAX_CHUNKS = 5_000;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Write pool: texts embedded by import and reindex per namespace per day. */
export function dailyBudget(env: Env): number {
  return positiveInt(env.EMBEDDING_DAILY_BUDGET, DEFAULT_DAILY_BUDGET);
}

/** Query pool: search-time query embeds per namespace per day. */
export function dailyQueryBudget(env: Env): number {
  return positiveInt(
    env.EMBEDDING_DAILY_QUERY_BUDGET,
    DEFAULT_DAILY_QUERY_BUDGET,
  );
}

function poolLimit(env: Env, operation: EmbeddingOperation): number {
  return operation === "query" ? dailyQueryBudget(env) : dailyBudget(env);
}

export function reindexMaxChunks(env: Env): number {
  return positiveInt(
    env.EMBEDDING_REINDEX_MAX_CHUNKS,
    DEFAULT_REINDEX_MAX_CHUNKS,
  );
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export async function getCredential(
  env: Env,
  namespace: string,
  provider: EmbeddingProviderId = "openai",
): Promise<CredentialRow | null> {
  return queryOne<CredentialRow>(
    getDb(env),
    "SELECT * FROM embedding_credentials WHERE namespace = ? AND provider = ?",
    [namespace, provider],
  );
}

export type SetCredentialResult =
  { ok: true; row: CredentialRow } | { ok: false; reason: "kek_unavailable" };

/**
 * Stores or rotates a namespace's provider key. The same credential_id is kept
 * across rotations so the AAD binding stays stable. Fails closed (no write)
 * when no KEK is configured.
 */
export async function setCredential(
  env: Env,
  namespace: string,
  provider: EmbeddingProviderId,
  apiKey: string,
): Promise<SetCredentialResult> {
  const kek = await currentKek(env);
  if (!kek) return { ok: false, reason: "kek_unavailable" };

  const db = getDb(env);
  const fingerprint = (await sha256Hex(apiKey)).slice(0, 8);
  const last4 = apiKey.slice(-4);

  // The AAD binds the credential_id, so the sealed value must be produced for
  // the id of the row that ends up holding it. Rotation (UPDATE) keeps the
  // id; a first write (INSERT) mints one. Two concurrent first PUTs both see
  // no row; the loser's INSERT hits the unique (namespace, provider) index and
  // falls back to rotating the winner's row, so the result is deterministic
  // (last writer wins) instead of a 500.
  async function rotate(existing: CredentialRow): Promise<void> {
    const sealed = await sealKey(
      kek!,
      apiKey,
      credentialAad(namespace, existing.credential_id, provider),
    );
    await execute(
      db,
      `UPDATE embedding_credentials
         SET ciphertext = ?, iv = ?, kek_version = ?, fingerprint = ?, last4 = ?,
             status = 'active', consecutive_auth_failures = 0,
             rotate_time = ?, revoke_time = NULL
       WHERE credential_id = ?`,
      [
        sealed.ciphertext,
        sealed.iv,
        kek!.version,
        fingerprint,
        last4,
        now(),
        existing.credential_id,
      ],
    );
  }

  const existing = await getCredential(env, namespace, provider);
  if (existing) {
    await rotate(existing);
  } else {
    const credentialId = uid();
    const sealed = await sealKey(
      kek,
      apiKey,
      credentialAad(namespace, credentialId, provider),
    );
    try {
      await execute(
        db,
        `INSERT INTO embedding_credentials
           (credential_id, namespace, provider, ciphertext, iv, kek_version,
            fingerprint, last4, status, consecutive_auth_failures, create_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?)`,
        [
          credentialId,
          namespace,
          provider,
          sealed.ciphertext,
          sealed.iv,
          kek.version,
          fingerprint,
          last4,
          now(),
        ],
      );
    } catch (error) {
      const winner = await getCredential(env, namespace, provider);
      if (!winner) throw error;
      await rotate(winner);
    }
  }
  invalidateKeyCache(namespace);
  const row = await getCredential(env, namespace, provider);
  return { ok: true, row: row! };
}

/** Revokes: zeroes the ciphertext and stamps revoke_time. Returns rows touched. */
export async function revokeCredential(
  env: Env,
  namespace: string,
  provider: EmbeddingProviderId = "openai",
): Promise<number> {
  const result = await execute(
    getDb(env),
    `UPDATE embedding_credentials
       SET ciphertext = NULL, iv = NULL, status = 'revoked', revoke_time = ?
     WHERE namespace = ? AND provider = ? AND status != 'revoked'`,
    [now(), namespace, provider],
  );
  // Without a credential nothing keeps vectors in step with the data, so every
  // world of the namespace goes stale: a later PUT of a key must not make
  // vectors built before the revoke (and before any deletes made while there
  // was no embedder) live again. Reindex repairs it.
  await markNamespaceStale(env, namespace);
  invalidateKeyCache(namespace);
  return result.rowsAffected;
}

/** Namespace deletion: revoke every credential the namespace holds. */
export async function revokeNamespaceCredentials(
  env: Env,
  namespace: string,
): Promise<number> {
  const result = await execute(
    getDb(env),
    `UPDATE embedding_credentials
       SET ciphertext = NULL, iv = NULL, status = 'revoked', revoke_time = ?
     WHERE namespace = ? AND status != 'revoked'`,
    [now(), namespace],
  );
  await markNamespaceStale(env, namespace);
  invalidateKeyCache(namespace);
  return result.rowsAffected;
}

export async function recordAuthFailure(
  env: Env,
  credentialId: string,
): Promise<void> {
  await execute(
    getDb(env),
    `UPDATE embedding_credentials
       SET consecutive_auth_failures = consecutive_auth_failures + 1,
           status = CASE WHEN consecutive_auth_failures + 1 >= ? THEN 'invalid' ELSE status END
     WHERE credential_id = ? AND status = 'active'`,
    [AUTH_FAILURE_THRESHOLD, credentialId],
  );
}

export async function recordAuthSuccess(
  env: Env,
  credentialId: string,
): Promise<void> {
  await execute(
    getDb(env),
    "UPDATE embedding_credentials SET consecutive_auth_failures = 0 WHERE credential_id = ? AND consecutive_auth_failures > 0",
    [credentialId],
  );
}

// ---------------------------------------------------------------------------
// Decrypted-key cache (isolate memory only, TTL <= 60 s; design 2.2 / 7)
// ---------------------------------------------------------------------------

export const KEY_CACHE_TTL_MS = 60_000;

type CachedKey = { key: string; credentialId: string; expires: number };
const keyCache = new Map<string, CachedKey>();

export function invalidateKeyCache(namespace?: string): void {
  if (namespace === undefined) keyCache.clear();
  else keyCache.delete(namespace);
}

export type ResolvedKey = { key: string; credentialId: string };

/**
 * Decrypts the namespace's active key. Returns null (never throws) when the
 * credential is absent, not active, the KEK is missing, or decryption fails
 * (tamper, wrong namespace). Lazily re-encrypts under the newest KEK.
 */
export async function resolveApiKey(
  env: Env,
  namespace: string,
  provider: EmbeddingProviderId = "openai",
): Promise<ResolvedKey | null> {
  const cached = keyCache.get(namespace);
  if (cached && cached.expires > Date.now()) {
    return { key: cached.key, credentialId: cached.credentialId };
  }
  keyCache.delete(namespace);

  try {
    const row = await getCredential(env, namespace, provider);
    if (!row || row.status !== "active" || !row.ciphertext || !row.iv) {
      return null;
    }
    const kek = await kekForVersion(env, row.kek_version);
    if (!kek) return null;
    const key = await openKey(
      kek,
      { ciphertext: row.ciphertext, iv: row.iv },
      credentialAad(row.namespace, row.credential_id, row.provider),
    );
    if (key === null) {
      console.warn("embedding credential could not be opened", {
        namespace,
        reason: "decrypt_failed",
      });
      return null;
    }
    keyCache.set(namespace, {
      key,
      credentialId: row.credential_id,
      expires: Date.now() + KEY_CACHE_TTL_MS,
    });
    await rewrapIfStale(env, row, key);
    return { key, credentialId: row.credential_id };
  } catch (error) {
    console.warn("embedding credential lookup failed", {
      namespace,
      reason: describeError(error),
    });
    return null;
  }
}

async function rewrapIfStale(
  env: Env,
  row: CredentialRow,
  key: string,
): Promise<void> {
  try {
    const kek = await currentKek(env);
    if (!kek || kek.version <= row.kek_version) return;
    const sealed = await sealKey(
      kek,
      key,
      credentialAad(row.namespace, row.credential_id, row.provider),
    );
    await execute(
      getDb(env),
      // Compare-and-swap on the exact ciphertext that was read, and only while
      // active: a concurrent rotation (new ciphertext, same kek_version) or
      // revoke (ciphertext erased) must win over this background rewrap.
      `UPDATE embedding_credentials SET ciphertext = ?, iv = ?, kek_version = ?
        WHERE credential_id = ? AND ciphertext = ? AND iv = ? AND kek_version = ? AND status = 'active'`,
      [
        sealed.ciphertext,
        sealed.iv,
        kek.version,
        row.credential_id,
        row.ciphertext,
        row.iv,
        row.kek_version,
      ],
    );
  } catch {
    // Best effort: the old KEK still opens the record.
  }
}

// ---------------------------------------------------------------------------
// Budget guard
// ---------------------------------------------------------------------------

export type EmbeddingOperation = "index" | "query";

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

// ---------------------------------------------------------------------------
// World embedding state and status
// ---------------------------------------------------------------------------

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

const IN_CHUNK = 50;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

/**
 * Derives embeddingStatus for a batch of worlds with at most a few queries.
 * Never throws: a lookup failure degrades to "unconfigured" (keyword-only).
 */
export async function loadEmbeddingStatuses(
  env: Env,
  worlds: Array<{
    world_id: string;
    namespace: string;
    embedding_model: string;
  }>,
): Promise<Map<string, EmbeddingStatus>> {
  const out = new Map<string, EmbeddingStatus>();
  if (worlds.length === 0) return out;
  const db = getDb(env);
  try {
    const enabled = await byokEnabled(env);
    const credentials = new Map<string, CredentialStatus>();
    const states = new Map<
      string,
      { state: WorldEmbeddingStateValue; model: string }
    >();
    if (enabled) {
      const namespaces = [...new Set(worlds.map((w) => w.namespace))];
      for (const batch of chunks(namespaces, IN_CHUNK)) {
        const rows =
          (await query<{ namespace: string; status: CredentialStatus }>(
            db,
            `SELECT namespace, status FROM embedding_credentials WHERE provider = 'openai' AND namespace IN (${placeholders(batch.length)})`,
            batch,
          )) ?? [];
        for (const row of rows) credentials.set(row.namespace, row.status);
      }
      for (const batch of chunks(
        worlds.map((w) => w.world_id),
        IN_CHUNK,
      )) {
        const rows =
          (await query<{
            world_id: string;
            state: WorldEmbeddingStateValue;
            model: string;
          }>(
            db,
            `SELECT world_id, state, model FROM world_embedding_state WHERE world_id IN (${placeholders(batch.length)})`,
            batch,
          )) ?? [];
        for (const row of rows) {
          states.set(row.world_id, { state: row.state, model: row.model });
        }
      }
    }
    for (const world of worlds) {
      out.set(
        world.world_id,
        computeEmbeddingStatus({
          enabled,
          model: world.embedding_model,
          credentialStatus: credentials.get(world.namespace),
          state: states.get(world.world_id),
        }),
      );
    }
  } catch (error) {
    console.warn("embedding status lookup failed", {
      reason: describeError(error),
    });
    for (const world of worlds) out.set(world.world_id, "unconfigured");
  }
  return out;
}
