// Local health test for worlds-api
// Usage: node scripts/local-health.mjs [baseUrl]
//   Defaults to http://localhost:8787 for wrangler dev
//   Set WORLDS_API_ADMIN_KEY env var for authenticated tests

import {
  assertBadRequest,
  assertOk,
  assertUnauthorized,
  authHeaders,
  BASE_URL,
  stats,
  test,
} from "./health-lib.mjs";

// ── Start ──

console.log(`\nWorlds API local health test`);
console.log(`  Base URL: ${BASE_URL}\n`);

const readyResponse = await fetch(`${BASE_URL}/ready`);
await assertOk(readyResponse);
const readyBody = await readyResponse.json();
if (readyBody.status !== "ready") {
  throw new Error(`Readiness preflight failed: status is ${readyBody.status}`);
}

// ── Health ───

await test("GET /health returns ok (or degraded if no DB)", async () => {
  const res = await fetch(`${BASE_URL}/health`);
  const body = await res.json();
  if (res.status !== 200 && res.status !== 503) {
    throw new Error(`Unexpected status ${res.status}: ${JSON.stringify(body)}`);
  }
  if (!body.status) throw new Error("Missing status");
  console.log(`        status: ${body.status}`);
});

await test("GET /openapi.json returns OpenAPI spec", async () => {
  const res = await fetch(`${BASE_URL}/openapi.json`);
  await assertOk(res);
  const body = await res.json();
  if (!body.openapi) throw new Error("Missing openapi version");
  if (!body.paths) throw new Error("Missing paths");
  console.log(
    `        OpenAPI ${body.openapi}: ${
      Object.keys(body.paths).length
    } paths, ${body.info.title}`,
  );
});

// ── Auth validation ───

await test("GET /worlds without token returns 401", async () => {
  const res = await fetch(`${BASE_URL}/worlds`);
  await assertUnauthorized(res);
});

await test("GET /worlds with invalid token returns 401", async () => {
  const res = await fetch(`${BASE_URL}/worlds`, {
    headers: { Authorization: "Bearer wzw_invalidtoken123" },
  });
  await assertUnauthorized(res);
});

// ── Schema validation ───

await test("POST /worlds/:id/search without body returns 400", async () => {
  // Without a body, zod validation rejects
  const res = await fetch(`${BASE_URL}/worlds/test/search`, {
    method: "POST",
    headers: authHeaders(),
  });
  await assertBadRequest(res);
});

await test("POST /worlds/sparql without world id returns 400", async () => {
  const res = await fetch(`${BASE_URL}/worlds/sparql`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
  await assertBadRequest(res);
  const body = await res.json();
  if (!body.error?.code) throw new Error("Missing error code");
});

// ── Authenticated health flow ───

await import("./health-flow.mjs");

// ── Results ───

console.log(
  `\n${stats.passed} passed, ${stats.failed} failed, ${stats.passed + stats.failed} total\n`,
);
process.exit(stats.failed > 0 ? 1 : 0);
