import type { Env } from "../../env";

/**
 * AES-256-GCM sealing of customer provider keys (design section 2.1).
 *
 * - The KEK is a Worker secret (`EMBEDDING_KEK_V<n>`, base64 of 32 bytes).
 * - Every record has its own random 96-bit IV.
 * - AAD binds `namespace|credential_id|provider`, so a ciphertext copied to
 *   another namespace/credential fails to open.
 */

const KEK_BYTES = 32;
const IV_BYTES = 12;

export type KekRef = { version: number; key: CryptoKey };

function fromBase64(value: string): Uint8Array | null {
  try {
    const normalized = value.trim().replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Versions the Env type can carry, newest first. */
const KEK_VERSIONS = [2, 1] as const;

function rawKek(env: Env, version: number): string | undefined {
  if (version === 1) return env.EMBEDDING_KEK_V1;
  if (version === 2) return env.EMBEDDING_KEK_V2;
  return undefined;
}

async function importKek(raw: string | undefined, version: number) {
  if (!raw) return null;
  const bytes = fromBase64(raw);
  // A malformed KEK is treated as absent: fail closed, never throw.
  if (!bytes || bytes.length !== KEK_BYTES) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    bytes as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  return { version, key } satisfies KekRef;
}

/**
 * The newest KEK, used for new writes. Null when none is configured.
 *
 * Fails closed on a malformed newest KEK: if EMBEDDING_KEK_V2 is present but
 * unusable, this returns null rather than silently sealing new keys under V1
 * (which would make a botched rotation look healthy and keep V1 pinned). The
 * deployment is then keyword-only and credential writes return 503 until the
 * secret is fixed. Older versions are only ever consulted per stored record
 * (kekForVersion), never as a write fallback.
 */
export async function currentKek(env: Env): Promise<KekRef | null> {
  for (const version of KEK_VERSIONS) {
    const raw = rawKek(env, version);
    if (!raw) continue;
    return importKek(raw, version);
  }
  return null;
}

/** The KEK for a stored record's `kek_version`, or null when unavailable. */
export async function kekForVersion(
  env: Env,
  version: number,
): Promise<KekRef | null> {
  return importKek(rawKek(env, version), version);
}

export function credentialAad(
  namespace: string,
  credentialId: string,
  provider: string,
): Uint8Array {
  return new TextEncoder().encode(`${namespace}|${credentialId}|${provider}`);
}

export type SealedKey = { ciphertext: string; iv: string };

export async function sealKey(
  kek: KekRef,
  plaintext: string,
  aad: Uint8Array,
): Promise<SealedKey> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: aad as BufferSource,
    },
    kek.key,
    new TextEncoder().encode(plaintext),
  );
  return {
    ciphertext: toBase64(new Uint8Array(sealed)),
    iv: toBase64(iv),
  };
}

/** Returns the plaintext, or null on any failure (tamper, wrong AAD/KEK). */
export async function openKey(
  kek: KekRef,
  sealed: SealedKey,
  aad: Uint8Array,
): Promise<string | null> {
  const ciphertext = fromBase64(sealed.ciphertext);
  const iv = fromBase64(sealed.iv);
  if (!ciphertext || !iv || iv.length !== IV_BYTES) return null;
  try {
    const opened = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv as BufferSource,
        additionalData: aad as BufferSource,
      },
      kek.key,
      ciphertext as BufferSource,
    );
    return new TextDecoder().decode(opened);
  } catch {
    return null;
  }
}
