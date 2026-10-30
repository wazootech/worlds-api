export const BASE_URL = process.argv[2] ?? "http://localhost:8787";
try {
  const url = new URL(BASE_URL);
  if (
    !(
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    ) &&
    !(url.protocol === "https:" && url.hostname === "data-qa.wazoo.dev")
  ) {
    throw new Error(
      `Invalid base URL: must be http://localhost, http://127.0.0.1, or https://data-qa.wazoo.dev`,
    );
  }
} catch (err) {
  throw new Error(
    `Invalid base URL: must be http://localhost, http://127.0.0.1, or https://data-qa.wazoo.dev`,
    { cause: err },
  );
}
export const ADMIN_KEY = required("WORLDS_API_ADMIN_KEY");

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Pass/fail counters shared with local-health.mjs.
export const stats = { passed: 0, failed: 0 };

export async function test(name, fn) {
  try {
    await fn();
    stats.passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    stats.failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
  }
}

export async function assertStatus(res, expected) {
  if (res.status !== expected) {
    const body = await res.text();
    throw new Error(
      `Expected ${expected}, got ${res.status}: ${body.slice(0, 200)}`,
    );
  }
}

export async function assertOk(res) {
  await assertStatus(res, 200);
}

export async function assertCreated(res) {
  await assertStatus(res, 201);
}

export async function assertBadRequest(res) {
  await assertStatus(res, 400);
}

export async function assertUnauthorized(res) {
  await assertStatus(res, 401);
}

export async function assertNotFound(res) {
  await assertStatus(res, 404);
}

export function authHeaders() {
  return {
    Authorization: `Bearer ${ADMIN_KEY}`,
    "Content-Type": "application/json",
  };
}
