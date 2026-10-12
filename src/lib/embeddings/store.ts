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

export const DEFAULT_DAILY_BUDGET = 20_000;
export const DEFAULT_REINDEX_MAX_CHUNKS = 5_000;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function dailyBudget(env: Env): number {
  return positiveInt(env.EMBEDDING_DAILY_BUDGET, DEFAULT_DAILY_BUDGET);
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
  const existing = await getCredential(env, namespace, provider);
  const credentialId = existing?.credential_id ?? uid();
  const sealed = await sealKey(
    kek,
    apiKey,
    credentialAad(namespace, credentialId, provider),
  );
  const fingerprint = (await sha256Hex(apiKey)).slice(0, 8);
  const last4 = apiKey.slice(-4);
  const ts = now();

  if (existing) {
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
        kek.version,
        fingerprint,
        last4,
        ts,
        credentialId,
      ],
    );
  } else {
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
        ts,
      ],
    );
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
      "UPDATE embedding_credentials SET ciphertext = ?, iv = ?, kek_version = ? WHERE credential_id = ? AND kek_version = ?",
      [
        sealed.ciphertext,
        sealed.iv,
        kek.version,
        row.credential_id,
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
 * Atomically reserves `units` embeddings for a namespace today. Returns false
 * (and reserves nothing) when it would exceed the daily budget. Must be called
 * before the provider is contacted; spend is not refunded on provider failure.
 */
export async function reserveBudget(
  env: Env,
  namespace: string,
  units: number,
  operation: EmbeddingOperation,
): Promise<boolean> {
  if (units <= 0) return true;
  const limit = dailyBudget(env);
  if (units > limit) return false;
  const indexUnits = operation === "index" ? units : 0;
  const queryUnits = operation === "query" ? units : 0;
  const result = await execute(
    getDb(env),
    `INSERT INTO embedding_usage (namespace, day, units, index_units, query_units, update_time)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(namespace, day) DO UPDATE SET
       units = units + excluded.units,
       index_units = index_units + excluded.index_units,
       query_units = query_units + excluded.query_units,
       update_time = excluded.update_time
     WHERE units + excluded.units <= ?`,
    [namespace, utcDay(), units, indexUnits, queryUnits, now(), limit],
  );
  return result.rowsAffected > 0;
}

/** Texts still available today (0 when exhausted). */
export async function remainingBudget(
  env: Env,
  namespace: string,
): Promise<number> {
  const row = await queryOne<{ units: number }>(
    getDb(env),
    "SELECT units FROM embedding_usage WHERE namespace = ? AND day = ?",
    [namespace, utcDay()],
  );
  return Math.max(0, dailyBudget(env) - Number(row?.units ?? 0));
}

// ---------------------------------------------------------------------------
// World embedding state and status
// ---------------------------------------------------------------------------

export type WorldEmbeddingStateValue = "stale" | "partial" | "ready";

export type EmbeddingStatus =
  "unconfigured" | "no_credential" | "invalid" | "stale" | "partial" | "ready";

export async function getWorldState(
  env: Env,
  worldId: string,
): Promise<{ state: WorldEmbeddingStateValue; model: string } | null> {
  return queryOne<{ state: WorldEmbeddingStateValue; model: string }>(
    getDb(env),
    "SELECT state, model FROM world_embedding_state WHERE world_id = ?",
    [worldId],
  );
}

export async function setWorldState(
  env: Env,
  worldId: string,
  state: WorldEmbeddingStateValue,
  model: string,
): Promise<void> {
  await execute(
    getDb(env),
    `INSERT INTO world_embedding_state (world_id, state, model, update_time)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(world_id) DO UPDATE SET
       state = excluded.state, model = excluded.model, update_time = excluded.update_time`,
    [worldId, state, model, now()],
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

/** True when this deployment can run BYOK embeddings at all. */
export async function byokEnabled(env: Env): Promise<boolean> {
  return env.EMBEDDING_PROVIDER === "byok" && (await currentKek(env)) !== null;
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
