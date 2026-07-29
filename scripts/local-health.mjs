// Local health test for worlds-api
// Usage: node scripts/local-health.mjs [baseUrl]
//   Defaults to http://localhost:8787 for wrangler dev
//   Set WORLDS_ADMIN_KEY env var for authenticated tests

const BASE_URL = process.argv[2] ?? "http://localhost:8787";
const ADMIN_KEY = required("WORLDS_ADMIN_KEY");

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
  }
}

async function assertStatus(res, expected) {
  if (res.status !== expected) {
    const body = await res.text();
    throw new Error(
      `Expected ${expected}, got ${res.status}: ${body.slice(0, 200)}`,
    );
  }
}

async function assertOk(res) {
  await assertStatus(res, 200);
}

async function assertCreated(res) {
  await assertStatus(res, 201);
}

async function assertBadRequest(res) {
  await assertStatus(res, 400);
}

async function assertUnauthorized(res) {
  await assertStatus(res, 401);
}

async function assertForbidden(res) {
  await assertStatus(res, 403);
}

async function assertNotFound(res) {
  await assertStatus(res, 404);
}

function authHeaders() {
  return {
    Authorization: `Bearer ${ADMIN_KEY}`,
    "Content-Type": "application/json",
  };
}

// ── Start ──

console.log(`\nWorlds API local health test`);
console.log(`  Base URL: ${BASE_URL}\n`);

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
    `        OpenAPI ${body.openapi}: ${Object.keys(body.paths).length} paths, ${body.info.title}`,
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

const testNamespace = `health-${Date.now()}`;
const testWorldId = `health-world-${Date.now()}`;

await test("GET /worlds returns list (may be empty)", async () => {
    const res = await fetch(
      `${BASE_URL}/worlds?namespace=${testNamespace}`,
      { headers: authHeaders() },
    );
    await assertOk(res);
    const body = await res.json();
    if (!Array.isArray(body.worlds)) throw new Error("worlds is not an array");
  });

  await test("POST /api-keys creates a key for the test namespace", async () => {
    const res = await fetch(`${BASE_URL}/api-keys`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        namespace: testNamespace,
        name: "health-test-key",
      }),
    });
    await assertCreated(res);
    const body = await res.json();
    if (!body.token) throw new Error("Missing token in response");
    if (!body.uid) throw new Error("Missing uid");
    console.log(`        key uid: ${body.uid}, token: ${body.token.slice(0, 8)}...`);
  });

  await test("GET /api-keys lists created keys", async () => {
    const res = await fetch(
      `${BASE_URL}/api-keys?namespace=${testNamespace}`,
      { headers: authHeaders() },
    );
    await assertOk(res);
    const body = await res.json();
    if (!Array.isArray(body.keys)) throw new Error("keys is not an array");
    console.log(`        keys for namespace: ${body.keys.length}`);
  });

  // Note: World CRUD requires a provisioned databaseUrl which we can't provide
  // in a local health test. Testing the validation only.
  await test("POST /worlds without databaseUrl returns 400", async () => {
    const res = await fetch(`${BASE_URL}/worlds`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        namespace: testNamespace,
        worldId: testWorldId,
        displayName: "Health Test",
      }),
    });
    await assertBadRequest(res);
    const body = await res.json();
    if (!body.error?.code) throw new Error("Missing error code");
    console.log(`        error: ${body.error.code}`);
  });

  await test("GET /worlds/:id for nonexistent world returns 404", async () => {
    const res = await fetch(
      `${BASE_URL}/worlds/nonexistent-zzz?namespace=${testNamespace}`,
      { headers: authHeaders() },
    );
    await assertNotFound(res);
  });

  // Cleanup: revoke the test key
  // We don't have the keyId directly, so skip this for now.
  // The test keys will be cleaned up by the API key revocation endpoint.

// ── Results ───

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);
