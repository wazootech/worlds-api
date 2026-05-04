import type { ApiKeyStorage } from "./api-key-storage.ts";

export interface VerifiedKey {
  keyId: string;
  scopes: string[];
}

export async function verifyApiKey(
  rawKey: string,
  storage: ApiKeyStorage,
): Promise<VerifiedKey> {
  const keyHash = await hashKey(rawKey);
  const record = await storage.findByHash(keyHash);
  if (!record) throw new Error("Invalid API key");
  if (record.revokedAt) throw new Error("API key revoked");
  if (record.expiresAt && record.expiresAt < Date.now()) {
    throw new Error("API key expired");
  }
  await storage.touchLastUsed(record.id);
  return { keyId: record.id, scopes: record.scopes };
}

export async function hashKey(rawKey: string): Promise<string> {
  const data = new TextEncoder().encode(rawKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateApiKey(prefix = "wk"): string {
  const random = crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "");
  return `${prefix}_${random.slice(0, 32)}`;
}
