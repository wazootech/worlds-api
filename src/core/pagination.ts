import { InvalidPageTokenError } from "#/errors.ts";

export type PageTokenVersion = 1;

export type PageTokenPayloadV1 = {
  v: PageTokenVersion;
  /** Offset into a stable, deterministically ordered result set. */
  o: number;
  /** Signature binding this token to a request parameter set. */
  sig: string;
};

function base64UrlEncode(bytes: Uint8Array): string {
  // Standard base64 then URL-safe.
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecodeToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stableJson(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string") return JSON.stringify(value);
  if (t === "number") return Number.isFinite(value) ? String(value) : "null";
  if (t === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableJson(v)).join(",")}]`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${
      keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")
    }}`;
  }
  // undefined / symbol / function
  return "null";
}

async function sha256Base64Url(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64UrlEncode(new Uint8Array(digest));
}

export type PageTokenSignatureParams = Record<string, unknown>;

/**
 * Produce a stable signature for a request parameter set.
 *
 * Intentionally excludes pageSize/pageToken; tokens remain valid if the caller
 * changes pageSize between requests (common AIP behavior).
 */
export async function signPageTokenParams(
  params: PageTokenSignatureParams,
): Promise<string> {
  return await sha256Base64Url(stableJson(params));
}

export function encodePageToken(payload: PageTokenPayloadV1): string {
  const json = JSON.stringify(payload);
  return base64UrlEncode(new TextEncoder().encode(json));
}

export function decodePageToken(token: string): PageTokenPayloadV1 {
  try {
    const bytes = base64UrlDecodeToBytes(token);
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as unknown;
    if (!isRecord(parsed)) throw new InvalidPageTokenError();
    if (parsed.v !== 1) throw new InvalidPageTokenError();
    const o = parsed.o;
    const sig = parsed.sig;
    if (
      typeof o !== "number" || !Number.isInteger(o) || o < 0 ||
      typeof sig !== "string" || sig.length === 0
    ) {
      throw new InvalidPageTokenError();
    }
    return { v: 1, o, sig };
  } catch (err) {
    if (err instanceof InvalidPageTokenError) throw err;
    throw new InvalidPageTokenError();
  }
}

export function assertPageTokenSig(
  decoded: PageTokenPayloadV1,
  expectedSig: string,
): void {
  if (decoded.sig !== expectedSig) {
    throw new InvalidPageTokenError("Invalid page token signature");
  }
}
