// Cross-platform launcher for `wrangler dev` under Infisical.
//
// `infisical run` injects secrets as process environment variables. Wrangler
// only maps process environment variables into the Worker's local bindings when
// CLOUDFLARE_INCLUDE_PROCESS_ENV is set and no .dev.vars file is present
// (Cloudflare's documented behavior for local development without a vars file),
// so set it here for every platform instead of relying on shell syntax that
// differs between POSIX shells and cmd.exe.
//
// Wrangler's bin entry is launched through `process.execPath` rather than a
// shell: on Windows the `wrangler` shim is a .cmd file, and Node cannot spawn a
// .cmd without a shell, while passing arguments through a shell concatenates
// them unescaped.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const wranglerBin = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);

if (!existsSync(wranglerBin)) {
  console.error(`Cannot find the Wrangler entry point at ${wranglerBin}.`);
  console.error("Run `npm install` in this checkout and try again.");
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [wranglerBin, "dev", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: { ...process.env, CLOUDFLARE_INCLUDE_PROCESS_ENV: "true" },
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});