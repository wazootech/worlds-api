/**
 * Fixed-message embedding errors.
 *
 * Provider response bodies, request ids, and request headers never reach an
 * error message: the engine copies `error.message` into `vectorSync.errors`
 * and `app.onError` logs and returns it, so every message here is a constant
 * keyed by class (design section 7, error leakage / key logging).
 */
export type EmbeddingErrorCode =
  | "budget_exceeded"
  | "no_credential"
  | "auth"
  | "rate_limited"
  | "timeout"
  | "provider_error"
  | "bad_request"
  | "bad_response";

const MESSAGES: Record<EmbeddingErrorCode, string> = {
  budget_exceeded: "embedding budget exceeded",
  no_credential: "embedding credential unavailable",
  auth: "embedding provider rejected the credential",
  rate_limited: "embedding provider rate limited",
  timeout: "embedding provider timed out",
  provider_error: "embedding provider error",
  bad_request: "embedding provider rejected the request",
  bad_response: "embedding provider returned an unexpected response",
};

export class EmbeddingError extends Error {
  readonly code: EmbeddingErrorCode;

  constructor(code: EmbeddingErrorCode) {
    super(MESSAGES[code]);
    this.name = "EmbeddingError";
    this.code = code;
  }
}

/** Class-only description of any thrown value, safe to log. */
export function describeError(error: unknown): string {
  if (error instanceof EmbeddingError) return error.code;
  if (error instanceof Error) return error.name;
  return "unknown";
}
