#!/usr/bin/env node

/**
 * Credential-free production canary for worlds-api. Read-only: GET requests
 * only, no admin key, no writes. Asserts the production deployment is up,
 * ready, serving its OpenAPI document, and rejecting unauthenticated callers.
 *
 * It does not prove secrets are correct; it proves the deployment is reachable
 * and enforcing its auth boundary.
 *
 * Usage: node scripts/prod-canary.mjs [baseUrl]
 *   Defaults to https://data.wazoo.dev. Any other host is refused.
 *
 * Exits non-zero if any assertion fails.
 */

const HOSTNAME = "data.wazoo.dev";
const TIMEOUT_MS = 10_000;
const ATTEMPTS = 2;

let BASE;
try {
  const url = new URL(process.argv[2] ?? `https://${HOSTNAME}`);
  if (url.protocol !== "https:" || url.hostname !== HOSTNAME) {
    throw new Error("host not allowed");
  }
  BASE = url.origin;
} catch {
  console.error(
    `Invalid base URL: must be https://${HOSTNAME} (got ${process.argv[2]})`,
  );
  process.exit(1);
}

async function get(path) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      return await fetch(`${BASE}${path}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function json(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

const checks = [
  [
    "/health",
    async () => {
      const r = await get("/health");
      const b = await json(r);
      return r.status === 200 && b?.status === "ok"
        ? null
        : `status ${r.status}, body.status ${String(b?.status)}`;
    },
  ],
  [
    "/ready",
    async () => {
      const r = await get("/ready");
      const b = await json(r);
      return r.status === 200 && b?.status === "ready"
        ? null
        : `status ${r.status}, body.status ${String(b?.status)}`;
    },
  ],
  [
    "/openapi.json",
    async () => {
      const r = await get("/openapi.json");
      const b = await json(r);
      return r.status === 200 &&
        b?.openapi !== undefined &&
        b?.paths !== undefined
        ? null
        : `status ${r.status}, not an OpenAPI document`;
    },
  ],
  [
    "rejects unauthenticated /worlds",
    async () => {
      const r = await get("/worlds");
      return r.status === 401 ? null : `expected 401, got ${r.status}`;
    },
  ],
];

console.log(`Canary (prod): ${BASE}`);

let failed = 0;
for (const [name, run] of checks) {
  let problem;
  try {
    problem = await run();
  } catch (err) {
    problem = `request failed: ${String(err)}`;
  }
  if (problem) {
    failed++;
    console.error(`FAIL ${name}: ${problem}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

if (failed > 0) {
  console.error(`${failed} of ${checks.length} canary checks failed`);
  process.exit(1);
}
console.log(`all ${checks.length} canary checks passed`);
