import type { Env } from "../../../env";
import { execute, getDb } from "../../db";
import type { EmbeddingProviderId } from "../catalog";
import {
  credentialAad,
  currentKek,
  kekForVersion,
  openKey,
  sealKey,
} from "../envelope";
import { describeError } from "../errors";
import type { CredentialRow } from "./credential-types";
import { getCredential } from "./credentials";
import { credentialSlot, KEY_CACHE_TTL_MS, keyCache } from "./key-cache";

export type ResolvedKey = { key: string; credentialId: string };

/**
 * Decrypts the namespace's active key. Returns null (never throws) when the
 * credential is absent, not active, the KEK is missing, or decryption fails
 * (tamper, wrong namespace). Lazily re-encrypts under the newest KEK.
 */
export async function resolveApiKey(
  env: Env,
  namespace: string,
  provider: EmbeddingProviderId,
): Promise<ResolvedKey | null> {
  const slot = credentialSlot(namespace, provider);
  const cached = keyCache.get(slot);
  if (cached && cached.expires > Date.now()) {
    return { key: cached.key, credentialId: cached.credentialId };
  }
  keyCache.delete(slot);

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
    keyCache.set(slot, {
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
