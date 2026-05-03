import { assertEquals } from "@std/assert";
import { createMainApp, createRpcApp } from "#/api/server/main.ts";

/** `hono-rate-limiter` installs a housekeeping interval on first use — disable op sanitization here. */
const mainAppLeakOpts = { sanitizeOps: false, sanitizeResources: false };

function withContentLength(
  headers: HeadersInit | undefined,
  body: string,
): HeadersInit {
  const merged = new Headers(headers);
  const bytes = new TextEncoder().encode(body);
  merged.set("Content-Length", String(bytes.byteLength));
  return merged;
}

Deno.test({
  name: "createMainApp: POST /rpc listWorlds returns 200",
  ...mainAppLeakOpts,
}, async () => {
  const app = createMainApp();
  const body = JSON.stringify({ action: "listWorlds", request: {} });
  const res = await app.request("http://localhost/rpc", {
    method: "POST",
    headers: withContentLength({ "Content-Type": "application/json" }, body),
    body,
  });
  assertEquals(res.status, 200);
  const json = (await res.json()) as { action: string };
  assertEquals(json.action, "listWorlds");
});

Deno.test({
  name: "createMainApp: invalid RPC body returns 400 envelope",
  ...mainAppLeakOpts,
}, async () => {
  const app = createMainApp();
  const body = JSON.stringify({
    action: "listWorlds",
    request: { pageSize: -1 },
  });
  const res = await app.request("http://localhost/rpc", {
    method: "POST",
    headers: withContentLength({ "Content-Type": "application/json" }, body),
    body,
  });
  assertEquals(res.status, 400);
  const json = (await res.json()) as { error?: { code: string } };
  assertEquals(json.error?.code, "INVALID_ARGUMENT");
});

Deno.test({
  name: "createMainApp: oversized JSON body returns 413",
  ...mainAppLeakOpts,
}, async () => {
  const app = createMainApp();
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

Deno.test("createRpcApp: same oversized body is not rejected at transport layer", async () => {
  const app = createRpcApp();
  const padLen = 2_200_000;
  const body = '{"action":"listWorlds","request":{},"pad":"' +
    "a".repeat(padLen) +
    '"}';
  const res = await app.request("http://localhost/rpc", {
    method: "POST",
    headers: withContentLength({ "Content-Type": "application/json" }, body),
    body,
  });
  assertEquals(res.status, 200);
});

Deno.test({
  name: "createMainApp: OPTIONS /rpc includes CORS allow headers",
  ...mainAppLeakOpts,
}, async () => {
  const app = createMainApp();
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
