import type { Env } from "../../../env";
import { execute, getDb, now, uid } from "../../db";
import { sha256Hex } from "../../crypto";
import { modelIdsForProvider, type EmbeddingProviderId } from "../catalog";
import { credentialAad, currentKek, sealKey } from "../envelope";
import { markNamespaceStale } from "../vectors";
import type { CredentialRow } from "./credential-types";
import { getCredential } from "./credentials";
import { invalidateKeyCache } from "./key-cache";

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
  provider: EmbeddingProviderId,
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
  await markNamespaceStale(env, namespace, modelIdsForProvider(provider));
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
