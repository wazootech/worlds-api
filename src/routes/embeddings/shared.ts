import { z } from "@hono/zod-openapi";
import {
  authorize,
  forbidden,
  requireAccess,
  SCOPE_EMBEDDINGS_ADMIN,
  unauthorized,
} from "../../lib/auth";
import { ErrorResponseSchema } from "../../lib/schemas";
import {
  EMBEDDING_PROVIDER_IDS,
  type EmbeddingProviderId,
} from "../../lib/embeddings/catalog";
import type { CredentialRow } from "../../lib/embeddings/store";

export const namespaceParam = z.object({
  namespace: z.string().openapi({
    param: { name: "namespace", in: "path", required: true },
  }),
});

export const providerParam = namespaceParam.extend({
  provider: z.enum(EMBEDDING_PROVIDER_IDS).openapi({
    param: { name: "provider", in: "path", required: true },
    description:
      "Embedding provider whose credential this addresses. A namespace holds at most one credential per provider.",
  }),
});

/** Printable ASCII, no whitespace: also rules out header injection. */
export const API_KEY_PATTERN = /^[\x21-\x7e]{16,512}$/;

export function credentialResource(row: CredentialRow) {
  return {
    provider: row.provider as EmbeddingProviderId,
    status: row.status,
    fingerprint: row.fingerprint,
    last4: row.last4,
    createTime: row.create_time,
    rotateTime: row.rotate_time ?? undefined,
    revokeTime: row.revoke_time ?? undefined,
  };
}

export const notFound = {
  error: { code: "NOT_FOUND", message: "No embedding credential" },
};

/**
 * Namespace-level access. A world-scoped token is refused regardless of scope
 * (design 2.3), and the namespace always comes from the token, never the body.
 */
export function guard(
  auth: Awaited<ReturnType<typeof authorize>>,
  namespace: string,
): Response | null {
  if (!auth.admin && !auth.namespace) return unauthorized();
  if (!auth.admin && auth.worldId) return forbidden();
  return requireAccess(auth, namespace, undefined, SCOPE_EMBEDDINGS_ADMIN);
}

export const errorContent = {
  "application/json": { schema: ErrorResponseSchema },
};
