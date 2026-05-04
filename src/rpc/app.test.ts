import { assertEquals } from "@std/assert";
import { createRpcApp } from "#/rpc/mod.ts";
import { generateApiKey, hashKey } from "#/api-keys/api-key.ts";
import { ApiKeyStorage } from "#/api-keys/api-key-storage.ts";
import { createClient } from "@libsql/client";

function withContentLength(
  headers: HeadersInit | undefined,
  body: string,
): Headers {
  const merged = new Headers(headers);
  const bytes = new TextEncoder().encode(body);
  merged.set("Content-Length", String(bytes.byteLength));
  return merged;
}

Deno.test({
  name: "createRpcApp: POST /rpc listWorlds returns 200",
}, async () => {
  const apiKeyStorage = new ApiKeyStorage(
    createClient({ url: ":memory:" }),
  );
  const rawKey = generateApiKey("wk");
  const hashedKey = await hashKey(rawKey);
  await apiKeyStorage.createKey({
    id: "wk_test1",
    keyHash: hashedKey,
    scopes: ["world:*:*", "namespace:*:*"],
    createdAt: Date.now(),
  });
  const app = createRpcApp({
    apiKeyStorage,
  });
  const body = JSON.stringify({ action: "listWorlds", request: {} });
  const res = await app.request("http://localhost/rpc", {
    method: "POST",
    headers: withContentLength(
      { "Content-Type": "application/json", "X-Api-Key": rawKey },
      body,
    ),
    body,
  });
  assertEquals(res.status, 200);
  const json = (await res.json()) as { action: string };
  assertEquals(json.action, "listWorlds");
});

Deno.test({
  name: "createRpcApp: invalid RPC body returns 400 envelope",
}, async () => {
  const apiKeyStorage = new ApiKeyStorage(
    createClient({ url: ":memory:" }),
  );
  const rawKey = generateApiKey("wk");
  const hashedKey = await hashKey(rawKey);
  await apiKeyStorage.createKey({
    id: "wk_test2",
    keyHash: hashedKey,
    scopes: ["world:*:*", "namespace:*:*"],
    createdAt: Date.now(),
  });
  const app = createRpcApp({
    apiKeyStorage,
  });
  const body = JSON.stringify({
    action: "listWorlds",
    request: { pageSize: -1 },
  });
  const res = await app.request("http://localhost/rpc", {
    method: "POST",
    headers: withContentLength(
      { "Content-Type": "application/json", "X-Api-Key": rawKey },
      body,
    ),
    body,
  });
  assertEquals(res.status, 400);
  const json = (await res.json()) as { error?: { code: string } };
  assertEquals(json.error?.code, "INVALID_ARGUMENT");
});

Deno.test({
  name: "createRpcApp: missing world returns 404 envelope",
}, async () => {
  const apiKeyStorage = new ApiKeyStorage(
    createClient({ url: ":memory:" }),
  );
  const rawKey = generateApiKey("wk");
  const hashedKey = await hashKey(rawKey);
  await apiKeyStorage.createKey({
    id: "wk_test3",
    keyHash: hashedKey,
    scopes: ["world:*:*", "namespace:*:*"],
    createdAt: Date.now(),
  });
  const app = createRpcApp({
    apiKeyStorage,
  });
  const body = JSON.stringify({
    action: "deleteWorld",
    request: { source: "non-existent/world" },
  });
  const res = await app.request("http://localhost/rpc", {
    method: "POST",
    headers: withContentLength(
      { "Content-Type": "application/json", "X-Api-Key": rawKey },
      body,
    ),
    body,
  });
  assertEquals(res.status, 404);
  const json = (await res.json()) as { error?: { code: string } };
  assertEquals(json.error?.code, "NOT_FOUND");
});

Deno.test({
  name: "createRpcApp: duplicate world returns 409 envelope",
}, async () => {
  const apiKeyStorage = new ApiKeyStorage(
    createClient({ url: ":memory:" }),
  );
  const rawKey = generateApiKey("wk");
  const hashedKey = await hashKey(rawKey);
  await apiKeyStorage.createKey({
    id: "wk_test4",
    keyHash: hashedKey,
    scopes: ["world:*:*", "namespace:*:*"],
    createdAt: Date.now(),
  });
  const app = createRpcApp({
    apiKeyStorage,
  });
  const bodyCreate = JSON.stringify({
    action: "createWorld",
    request: { namespace: "test", id: "dupe" },
  });
  await app.request("http://localhost/rpc", {
    method: "POST",
    headers: withContentLength(
      { "Content-Type": "application/json", "X-Api-Key": rawKey },
      bodyCreate,
    ),
    body: bodyCreate,
  });
  const res = await app.request("http://localhost/rpc", {
    method: "POST",
    headers: withContentLength(
      { "Content-Type": "application/json", "X-Api-Key": rawKey },
      bodyCreate,
    ),
    body: bodyCreate,
  });
  assertEquals(res.status, 409);
  const json = (await res.json()) as { error?: { code: string } };
  assertEquals(json.error?.code, "ALREADY_EXISTS");
});

Deno.test({
  name: "createRpcApp: oversized JSON body returns 413",
}, async () => {
  const app = createRpcApp({ transport: {} }); // with transport (triggers 413)
  const padLen = 2_200_000;
  const body = '{"action":"listWorlds","request":{},"pad":"' +
    "a".repeat(padLen) +
    '"}';
  const res = await app.request("http://localhost/rpc", {
    method: "POST",
    headers: withContentLength({ "Content-Type": "application/json" }, body),
    body,
  });
  assertEquals(res.status, 413);
});

Deno.test("createRpcApp: without transport, oversized body is not rejected", async () => {
  const apiKeyStorage = new ApiKeyStorage(
    createClient({ url: ":memory:" }),
  );
  const rawKey = generateApiKey("wk");
  const hashedKey = await hashKey(rawKey);
  await apiKeyStorage.createKey({
    id: "wk_test5",
    keyHash: hashedKey,
    scopes: ["world:*:*", "namespace:*:*"],
    createdAt: Date.now(),
  });
  const app = createRpcApp({
    apiKeyStorage,
  }); // no transport
  const padLen = 2_200_000;
  const body = '{"action":"listWorlds","request":{},"pad":"' +
    "a".repeat(padLen) +
    '"}';
  const res = await app.request("http://localhost/rpc", {
    method: "POST",
    headers: withContentLength(
      {
        "Content-Type": "application/json",
        "X-Api-Key": rawKey,
      },
      body,
    ),
    body,
  });
  assertEquals(res.status, 200);
});

Deno.test({
  name: "createRpcApp: OPTIONS /rpc includes CORS allow headers",
}, async () => {
  const app = createRpcApp({ transport: {} }); // with transport (CORS applied)
  const res = await app.request("http://localhost/rpc", {
    method: "OPTIONS",
    headers: {
      Origin: "https://example.com",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  assertEquals(res.status, 204);
  const allowOrigin = res.headers.get("Access-Control-Allow-Origin");
  const allowed = allowOrigin === "*" || allowOrigin === "https://example.com";
  assertEquals(allowed, true);
  assertEquals(
    Boolean(res.headers.get("Access-Control-Allow-Methods")?.includes("POST")),
    true,
  );
});
