export const KEY_CACHE_TTL_MS = 60_000;

type CachedKey = { key: string; credentialId: string; expires: number };
export const keyCache = new Map<string, CachedKey>();

/** A namespace holds one credential per provider; this is the lookup key for both. */
export const credentialSlot = (namespace: string, provider: string) =>
  `${namespace}|${provider}`;

/** Drops one namespace's cached keys (every provider), or all of them. */
export function invalidateKeyCache(namespace?: string): void {
  if (namespace === undefined) {
    keyCache.clear();
    return;
  }
  for (const key of keyCache.keys()) {
    if (key.startsWith(`${namespace}|`)) keyCache.delete(key);
  }
}
