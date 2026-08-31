/**
 * Prebuild script: creates node_modules junctions inside worlds-cloudflare
 * so wrangler/esbuild can resolve Deno-style @/ import aliases and
 * transitive dependencies from the local monorepo.
 *
 * Run after `npm install` in worlds-api:
 *   node scripts/resolve-cloudflare-deps.mjs
 */
import { mkdirSync, symlinkSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_ROOT = resolve(__dirname, "..");
const CLOUDFLARE_PKG = resolve(API_ROOT, "../worlds-cloudflare");
const SQLITE_PKG = resolve(API_ROOT, "../worlds-sqlite");

function junction(target, link) {
  if (existsSync(link)) return;
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(target, link, "junction");
  console.log(`  junction: ${link} -> ${target}`);
}

console.log("Resolving @worlds/cloudflare dependencies for wrangler...");

// worlds-cloudflare needs @/ -> its own src/ for internal aliases
junction(
  resolve(CLOUDFLARE_PKG, "src"),
  resolve(CLOUDFLARE_PKG, "node_modules", "@")
);

// worlds-cloudflare needs @worlds/sqlite resolved
junction(
  resolve(SQLITE_PKG),
  resolve(CLOUDFLARE_PKG, "node_modules", "@worlds", "sqlite")
);

// worlds-cloudflare needs @worlds/sdk resolved
const sdkPkg = resolve(API_ROOT, "node_modules", "@worlds", "sdk");
if (existsSync(sdkPkg)) {
  junction(
    sdkPkg,
    resolve(CLOUDFLARE_PKG, "node_modules", "@worlds", "sdk")
  );
}

// worlds-cloudflare needs @wazoo/sparql-engine resolved
const sparqlPkg = resolve(API_ROOT, "node_modules", "@wazoo", "sparql-engine");
if (existsSync(sparqlPkg)) {
  junction(
    sparqlPkg,
    resolve(CLOUDFLARE_PKG, "node_modules", "@wazoo", "sparql-engine")
  );
}

// worlds-sqlite needs @worlds/sdk resolved
if (existsSync(sdkPkg)) {
  junction(
    sdkPkg,
    resolve(SQLITE_PKG, "node_modules", "@worlds", "sdk")
  );
}

// worlds-sqlite needs @wazoo/sparql-engine resolved
if (existsSync(sparqlPkg)) {
  junction(
    sparqlPkg,
    resolve(SQLITE_PKG, "node_modules", "@wazoo", "sparql-engine")
  );
}

// worlds-cloudflare needs @langchain/textsplitters resolved
const langchainPkg = resolve(API_ROOT, "node_modules", "@langchain", "textsplitters");
if (existsSync(langchainPkg)) {
  junction(
    langchainPkg,
    resolve(CLOUDFLARE_PKG, "node_modules", "@langchain", "textsplitters")
  );
}

console.log("Done.");
