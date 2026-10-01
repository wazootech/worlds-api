// Verifies that the secrets worlds-api expects are present in the process
// environment, without ever printing a secret value: only the key name, whether
// it resolved, and its length.
//
// Run it through the Infisical CLI so the values come from the vault:
//
//   npm run secrets:check
//
// Exits non-zero when a required secret is missing. The secrets themselves are
// never written to stdout, stderr, or disk.

import { existsSync } from "node:fs";

// Mirrors the keys read from process.env in src/env.ts (fromProcessEnv).
const EXPECTED = [
  { name: "WORLDS_API_ADMIN_KEY", required: true },
  { name: "WAZOO_ENV", required: false },
  { name: "EMBEDDING_PROVIDER", required: false },
  { name: "CORS_ORIGINS", required: false },
  { name: "PORT", required: false },
  { name: "SPARQL_TIMEOUT_MS", required: false },
  { name: "SPARQL_MAX_QUERY_LENGTH", required: false },
  { name: "SPARQL_MAX_RESULTS", required: false },
  { name: "MAX_IMPORT_BYTES", required: false },
  { name: "MAX_IMPORT_QUADS", required: false },
  { name: "RATE_LIMIT_RPM", required: false },
  { name: "RATE_LIMIT_BURST", required: false },
];

let missingRequired = 0;

console.log("worlds-api secrets check — names and lengths only, never values.\n");

for (const { name, required } of EXPECTED) {
  const value = process.env[name];
  const resolved = typeof value === "string" && value.length > 0;

  if (resolved) {
    console.log(`  RESOLVED  ${name} (length ${value.length})`);
  } else {
    if (required) missingRequired++;
    const label = required ? "MISSING (required)" : "not set (optional)";
    console.log(`  ${label.padEnd(24)}${name}`);
  }
}

if (existsSync(".dev.vars")) {
  console.log(
    "\n  NOTE: a .dev.vars file exists in this directory. The Node server in\n" +
      "  src/server.ts only fills gaps from it, so rename it to .dev.vars.backup\n" +
      "  before trusting this result.",
  );
}

console.log();

if (missingRequired > 0) {
  console.error(
    `FAILED: ${missingRequired} required secret(s) did not resolve. Confirm the\n` +
      "Infisical project link (.infisical.json) and the selected environment.",
  );
  process.exit(1);
}

console.log("OK: every required secret resolved.");