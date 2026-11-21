import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { respond } from "../respond";
import { EmbeddingError, type EmbeddingErrorCode } from "./errors";

/**
 * `@worlds/cloudflare` throws when the embedding service fails or returns
 * vectors of the wrong length, before anything is written (worlds-cloudflare#91).
 * The SDK wraps the embedder's own error ("failed to vectorize literal chunk
 * blocks", cause = our EmbeddingError), but a wrong-length vector has no typed
 * cause, so it is recognised by its message.
 */
export const EMBEDDING_FAILURE_REASONS = [
  "budget_exceeded",
  "no_credential",
  "auth",
  "rate_limited",
  "timeout",
  "provider_error",
  "bad_request",
  "bad_response",
] as const satisfies readonly EmbeddingErrorCode[];

export type EmbeddingFailure = { reason: EmbeddingErrorCode };

const SDK_EMBED_MESSAGE =
  /failed to vectorize literal chunk blocks|does not match configured vectorDimensions/;
const MAX_CAUSE_DEPTH = 5;

/** Returns the embedding failure behind a thrown value, or null if it is not one. */
export function embeddingFailureOf(error: unknown): EmbeddingFailure | null {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (current instanceof EmbeddingError) return { reason: current.code };
    if (!(current instanceof Error)) return null;
    if (SDK_EMBED_MESSAGE.test(current.message)) {
      // The SDK wrapper hides the provider error in its cause; surface it.
      const inner = embeddingFailureOf(current.cause);
      return inner ?? { reason: "bad_response" };
    }
    current = current.cause;
  }
  return null;
}

export const EmbeddingFailureResponseSchema = z
  .object({
    error: z.object({
      code: z.literal("EMBEDDING_FAILED").openapi({
        description:
          "The embedding service failed or returned unusable vectors. Nothing was written; retrying the same request is safe.",
      }),
      message: z.string(),
      reason: z.enum(EMBEDDING_FAILURE_REASONS).openapi({
        description:
          "Class of the embedding failure (never provider text): no_credential, auth, rate_limited, timeout, provider_error, bad_request, or bad_response (including vectors of the wrong length).",
      }),
    }),
  })
  .openapi("EmbeddingFailureResponse");

/**
 * Answers an embedding failure: 429 EMBEDDING_BUDGET_EXCEEDED when the
 * namespace's budget ran out mid-request (the code the early refusal uses),
 * else 502 EMBEDDING_FAILED. Messages are constants, so no provider text leaks.
 */
export function embeddingFailureResponse(c: Context, f: EmbeddingFailure) {
  if (f.reason === "budget_exceeded") {
    return respond(
      c,
      {
        error: {
          code: "EMBEDDING_BUDGET_EXCEEDED",
          message: "The daily embedding budget for this namespace is used up",
        },
      },
      429,
    );
  }
  return respond(
    c,
    {
      error: {
        code: "EMBEDDING_FAILED",
        message: `The embedding service failed (${f.reason}); nothing was written. Retry later.`,
        reason: f.reason,
      },
    },
    502,
  );
}
