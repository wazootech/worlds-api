import type { TransportConfig } from "./types.ts";

/** Default POST `/rpc` body cap (bytes). Override with `WORLDS_RPC_BODY_LIMIT_BYTES`. */
export const DEFAULT_RPC_BODY_LIMIT_BYTES = 2 * 1024 * 1024;

/**
 * Loads {@link TransportConfig} from the current process environment.
 *
 * | Variable | Purpose |
 * | --------- | --------- |
 * | `WORLDS_RPC_BODY_LIMIT_BYTES` | Max JSON body bytes for `/rpc` |
 * | `WORLDS_CORS_ORIGIN` | Comma-separated origins or omit for `*` |
 * | `WORLDS_CORS_ALLOW_CREDENTIALS` | Set `true` to send credentials with CORS |
 * | `WORLDS_RATE_LIMIT_WINDOW_MS` | Rate-limit window length |
 * | `WORLDS_RATE_LIMIT_MAX` | Max requests per window per key |
 */
export function loadTransportConfigFromEnv(): TransportConfig {
  return {
    rpcBodyLimitBytes: readBodyLimitBytes(),
    corsOrigin: readCorsOrigin(),
    corsAllowCredentials:
      Deno.env.get("WORLDS_CORS_ALLOW_CREDENTIALS") === "true",
    rateLimitWindowMs: readRateLimitWindowMs(),
    rateLimitMax: readRateLimitMax(),
  };
}

/** Overlay programmatic overrides (tests, embedding) on top of a resolved config. */
export function mergeTransportConfig(
  base: TransportConfig,
  overrides?: Partial<TransportConfig>,
): TransportConfig {
  return overrides ? { ...base, ...overrides } : base;
}

function readBodyLimitBytes(): number {
  const raw = Deno.env.get("WORLDS_RPC_BODY_LIMIT_BYTES");
  if (!raw?.trim()) {
    return DEFAULT_RPC_BODY_LIMIT_BYTES;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RPC_BODY_LIMIT_BYTES;
}

function readCorsOrigin(): string | string[] {
  const raw = Deno.env.get("WORLDS_CORS_ORIGIN")?.trim();
  if (!raw) {
    return "*";
  }
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length === 1 ? parts[0]! : parts;
}

function readRateLimitWindowMs(): number {
  const raw = Deno.env.get("WORLDS_RATE_LIMIT_WINDOW_MS");
  const n = raw?.trim() ? Number(raw) : 60_000;
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

function readRateLimitMax(): number {
  const raw = Deno.env.get("WORLDS_RATE_LIMIT_MAX");
  const n = raw?.trim() ? Number(raw) : 2000;
  return Number.isFinite(n) && n > 0 ? n : 2000;
}
