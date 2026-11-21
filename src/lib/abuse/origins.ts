import type { Env } from "../../env";

// ---------------------------------------------------------------------------
// CORS origins
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWED_ORIGINS = [
  "https://console.wazoo.dev",
  "https://console-qa.wazoo.dev",
  "http://localhost:3000",
];

// Console PR previews are served at <preview-name>.preview.console.wazoo.dev
// (wazoo-console wrangler.preview.jsonc). They run branch code, so they are
// trusted only by the preview data plane (WAZOO_ENV "preview", this repo's
// wrangler.preview.toml) and, until the -qa hosts are removed, by QA. Never prod.
const CONSOLE_PREVIEW_ORIGIN =
  /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?\.preview\.console\.wazoo\.dev$/;

/**
 * Tightened CORS: exact-match against the env-configured list, or a curated
 * default plus, on preview (and legacy QA) only, the console preview origins.
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
  // "qa" stays until data-qa.wazoo.dev is retired; then only "preview" remains.
  const trustsPreviews = env.WAZOO_ENV === "preview" || env.WAZOO_ENV === "qa";
  return trustsPreviews && CONSOLE_PREVIEW_ORIGIN.test(origin);
}
