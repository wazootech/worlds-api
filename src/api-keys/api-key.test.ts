import { assertEquals, assertRejects } from "@std/assert";
import { generateApiKey, hashKey, verifyApiKey } from "./api-key.ts";
import { ApiKeyStorage, type StoredApiKey } from "./api-key-storage.ts";
import { createClient } from "@libsql/client";

// Use in-memory libsql for testing
const TEST_DB_URL = ":memory:";

async function createTestStorage() {
  const client = createClient({ url: TEST_DB_URL });
  const storage = new ApiKeyStorage(client);
  await storage.createKey({
    id: "test_key_1",
    keyHash: "hash1",
    scopes: ["read", "write"],
    createdAt: Date.now(),
  });
  return { client, storage };
}

Deno.test("generateApiKey - creates key with prefix", () => {
  const key = generateApiKey("wk");
  assertEquals(key.startsWith("wk_"), true);
  assertEquals(key.length > 3, true);
});

Deno.test("generateApiKey - default prefix is wk", () => {
  const key = generateApiKey();
  assertEquals(key.startsWith("wk_"), true);
});

Deno.test("hashKey - produces SHA-256 hex string", async () => {
  const hash = await hashKey("test_key_value");
  assertEquals(typeof hash, "string");
  assertEquals(hash.length, 64); // SHA-256 = 64 hex chars
});

Deno.test("hashKey - same input produces same hash", async () => {
  const hash1 = await hashKey("consistent");
  const hash2 = await hashKey("consistent");
  assertEquals(hash1, hash2);
});

Deno.test("ApiKeyStorage - create and findByHash", async () => {
  const { storage } = await createTestStorage();
  const key = await hashKey("raw_key_123");
  const found = await storage.findByHash(key);
  assertEquals(found, null); // different hash

  // Create with correct hash
  const rawKey = "my_secret_key";
  const hashedKey = await hashKey(rawKey);
  const storedKey: StoredApiKey = {
    id: "wk_test123",
    keyHash: hashedKey,
    label: "Test Key",
    scopes: ["read"],
    createdAt: Date.now(),
  };
  await storage.createKey(storedKey);

  const foundKey = await storage.findByHash(hashedKey);
  assertEquals(foundKey?.id, "wk_test123");
  assertEquals(foundKey?.scopes, ["read"]);
});

Deno.test("ApiKeyStorage - findByHash returns null for revoked key", async () => {
  const { storage } = await createTestStorage();
  const rawKey = "revokable_key";
  const hashedKey = await hashKey(rawKey);
  const storedKey: StoredApiKey = {
    id: "wk_revokable",
    keyHash: hashedKey,
    scopes: [],
    createdAt: Date.now(),
  };
  await storage.createKey(storedKey);
  await storage.revokeKey("wk_revokable");

  const found = await storage.findByHash(hashedKey);
  assertEquals(found, null);
});

Deno.test("ApiKeyStorage - revokeKey", async () => {
  const { storage } = await createTestStorage();
  const rawKey = "to_revoke";
  const hashedKey = await hashKey(rawKey);
  const storedKey: StoredApiKey = {
    id: "wk_revoke",
    keyHash: hashedKey,
    scopes: [],
    createdAt: Date.now(),
  };
  await storage.createKey(storedKey);
  await storage.revokeKey("wk_revoke");

  const found = await storage.findByHash(hashedKey);
  assertEquals(found, null);
});

Deno.test("ApiKeyStorage - touchLastUsed", async () => {
  const { storage } = await createTestStorage();
  const rawKey = "touch_test";
  const hashedKey = await hashKey(rawKey);
  const storedKey: StoredApiKey = {
    id: "wk_touch",
    keyHash: hashedKey,
    scopes: [],
    createdAt: Date.now(),
  };
  await storage.createKey(storedKey);
  await storage.touchLastUsed("wk_touch");

  const found = await storage.findByHash(hashedKey);
  assertEquals(found?.lastUsedAt !== undefined, true);
});

Deno.test("verifyApiKey - valid key", async () => {
  const { storage } = await createTestStorage();
  const rawKey = "valid_key_12345";
  const hashedKey = await hashKey(rawKey);
  const storedKey: StoredApiKey = {
    id: "wk_valid",
    keyHash: hashedKey,
    scopes: ["read", "write"],
    createdAt: Date.now(),
  };
  await storage.createKey(storedKey);

  const verified = await verifyApiKey(rawKey, storage);
  assertEquals(verified.keyId, "wk_valid");
  assertEquals(verified.scopes, ["read", "write"]);
});

Deno.test("verifyApiKey - invalid key throws", async () => {
  const { storage } = await createTestStorage();
  await assertRejects(
    () => verifyApiKey("invalid_key", storage),
    Error,
    "Invalid API key",
  );
});

Deno.test("verifyApiKey - revoked key throws", async () => {
  const { storage } = await createTestStorage();
  const rawKey = "revoked_key";
  const hashedKey = await hashKey(rawKey);
  const storedKey: StoredApiKey = {
    id: "wk_revoked",
    keyHash: hashedKey,
    scopes: [],
    createdAt: Date.now(),
  };
  await storage.createKey(storedKey);
  await storage.revokeKey("wk_revoked");

  await assertRejects(
    () => verifyApiKey(rawKey, storage),
    Error,
    "Invalid API key",
  );
});

Deno.test("verifyApiKey - expired key throws", async () => {
  const { storage } = await createTestStorage();
  const rawKey = "expired_key";
  const hashedKey = await hashKey(rawKey);
  const storedKey: StoredApiKey = {
    id: "wk_expired",
    keyHash: hashedKey,
    scopes: [],
    createdAt: Date.now(),
    expiresAt: Date.now() - 1000, // expired 1 second ago
  };
  await storage.createKey(storedKey);

  await assertRejects(
    () => verifyApiKey(rawKey, storage),
    Error,
    "API key expired",
  );
});
