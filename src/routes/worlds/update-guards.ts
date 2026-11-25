import type { Env } from "../../env";
import { forbidden } from "../../lib/auth";
import { getCredentialForModel } from "../../lib/embeddings/store";
import { respond } from "../../lib/respond";
import type { Context } from "hono";

/**
 * A model change is a state transition, not just a column write: it needs a
 * usable credential and leaves the world stale (design 4.1). Returns the 409
 * response to reject with, or null when the change may proceed.
 */
export async function requireCredentialForModelChange(
  c: Context<{ Bindings: Env }>,
  env: Env,
  namespace: string,
  embeddingModel: string,
): Promise<Response | null> {
  const credential = await getCredentialForModel(
    env,
    namespace,
    embeddingModel,
  );
  if (!credential || credential.status !== "active") {
    return respond(
      c,
      {
        error: {
          code: "EMBEDDING_CREDENTIAL_REQUIRED",
          message:
            "Set an active embedding credential for the namespace before choosing an embedding model",
        },
      },
      409,
    );
  }
  return null;
}

/**
 * State transitions through PATCH are control-plane only (wazoo-api#22).
 * Time-limited pauses are a namespace-key action and go through
 * POST /worlds/{worldId}/pause instead, because they need a duration.
 */
export function guardStateTransition(
  auth: { admin: boolean },
  row: { state: string },
  body: { state?: "active" | "suspended" },
): Response | null {
  if (body.state === undefined) return null;
  if (!auth.admin) {
    return forbidden("State transitions through PATCH are control-plane only");
  }
  if (body.state === "suspended" && row.state === "deleted") {
    return Response.json(
      { error: { code: "FAILED_PRECONDITION", message: "World is deleted" } },
      { status: 400 },
    );
  }
  return null;
}
