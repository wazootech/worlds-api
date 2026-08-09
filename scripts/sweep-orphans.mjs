#!/usr/bin/env node

// One-time operational sweep for the world-uid cutover (no backwards compat).
// Destroys orphaned Turso databases for soft-deleted-but-unpurged worlds whose
// grace period has elapsed, then marks them purged. Recomputes the Turso
// database name from the world_uid, so it also cleans up databases created by
// the legacy wazoo-api provisioning flow.
//
// Usage: LIBSQL_URL=... LIBSQL_AUTH_TOKEN=... TURSO_ORG=... TURSO_GROUP=... \
//        TURSO_PLATFORM_API_TOKEN=... WAZOO_ENV=prod node scripts/sweep-orphans.mjs

import { createClient } from "@libsql/client/web";

function databaseName(envName, worldUid) {
  return `wz-${envName}-${worldUid}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

const url = required("LIBSQL_URL");
const authToken = process.env.LIBSQL_AUTH_TOKEN;
const client = createClient({ url, authToken });

const rows = await client.execute({
  sql: "SELECT uid FROM worlds_metadata WHERE state = 'deleted' AND purge_status != 'purged' AND expire_time IS NOT NULL AND expire_time <= ?",
  args: [new Date().toISOString()],
});

let purged = 0;
let failed = 0;
for (const row of rows.rows) {
  const uid = String(row.uid);
  const name = databaseName(process.env.WAZOO_ENV ?? "prod", uid);
  try {
    await destroy(name);
    await client.execute({
      sql: "UPDATE worlds_metadata SET purge_status = 'purged', purged_at = ? WHERE uid = ?",
      args: [new Date().toISOString(), uid],
    });
    purged++;
    console.log(`purged ${uid} (${name})`);
  } catch (err) {
    failed++;
    console.error(`failed ${uid} (${name}): ${err.message}`);
  }
}
console.log(`\n${purged} purged, ${failed} failed`);

async function destroy(name) {
  const org = required("TURSO_ORG");
  const response = await fetch(
    `https://api.turso.tech/v1/organizations/${encodeURIComponent(org)}/databases/${encodeURIComponent(name)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${required("TURSO_PLATFORM_API_TOKEN")}` },
    },
  );
  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`Turso returned ${response.status}: ${text.slice(0, 200)}`);
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Set ${name}`);
    process.exit(1);
  }
  return value;
}
