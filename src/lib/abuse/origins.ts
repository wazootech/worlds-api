import type { Env } from "../../env";

// ---------------------------------------------------------------------------
// CORS origins
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWED_ORIGINS = [
  "https://console.wazoo.dev",
  "https://console-qa.wazoo.dev",
  "http://localhost:3000",
];

/**
 * Tightened CORS: exact-match against the env-configured list, or a curated
 * default that still permits the preview-worker origins used by PR deploys.
 */
export function isOriginAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return false;

  const configured = env.CORS_ORIGINS;
  if (configured) {
    const list = configured
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    return list.includes(origin);
  }

  if (DEFAULT_ALLOWED_ORIGINS.includes(origin)) return true;
  // Cloudflare preview workers: wazoo-console-pr-<n>.ethan-r-davidson.workers.dev
  return (
    origin === "https://ethan-r-davidson.workers.dev" ||
    origin.endsWith(".ethan-r-davidson.workers.dev")
  );
}
