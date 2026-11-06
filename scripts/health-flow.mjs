// Authenticated half of the health run: API keys and world access. Imported by
// local-health.mjs after the unauthenticated checks.
import {
  assertBadRequest,
  assertCreated,
  assertNotFound,
  assertOk,
  assertStatus,
  authHeaders,
  BASE_URL,
  test,
} from "./health-lib.mjs";

let testKeyUid;

const testNamespace = `health-${Date.now()}`;

await test("GET /worlds returns list (may be empty)", async () => {
  const res = await fetch(`${BASE_URL}/worlds`, { headers: authHeaders() });
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
  testKeyUid = body.uid;
  console.log(
    `        key uid: ${body.uid}, token: ${body.token.slice(0, 8)}...`,
  );
});

await test("GET /api-keys lists created keys", async () => {
  const res = await fetch(`${BASE_URL}/api-keys?namespace=${testNamespace}`, {
    headers: authHeaders(),
  });
  await assertOk(res);
  const body = await res.json();
  if (!Array.isArray(body.keys)) throw new Error("keys is not an array");
  console.log(`        keys for namespace: ${body.keys.length}`);
});

// World creation requires a namespace-scoped API key (tenancy comes from
// auth). The admin key alone must be rejected.
await test("POST /worlds with admin key (no namespace) returns 400", async () => {
  const res = await fetch(`${BASE_URL}/worlds`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      displayName: "Health Test",
    }),
  });
  await assertBadRequest(res);
  const body = await res.json();
  if (!body.error?.code) throw new Error("Missing error code");
  console.log(`        error: ${body.error.code}`);
});

await test("GET /worlds/:id for nonexistent world returns 404", async () => {
  const res = await fetch(`${BASE_URL}/worlds/w_00000000000000000000000000`, {
    headers: authHeaders(),
  });
  await assertNotFound(res);
});

if (testKeyUid) {
  await test("DELETE /api-keys/:keyId revokes the test key", async () => {
    const res = await fetch(`${BASE_URL}/api-keys/${testKeyUid}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (res.status !== 204) await assertStatus(res, 204);
  });
}
