import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../env";
import {
  authorize,
  forbidden,
  requireAccess,
  SCOPE_EMBEDDINGS_ADMIN,
  unauthorized,
} from "../lib/auth";
import { respond } from "../lib/respond";
import {
  EmbeddingCredentialRequestSchema,
  EmbeddingCredentialSchema,
  ErrorResponseSchema,
} from "../lib/schemas";
import {
  getCredential,
  revokeCredential,
  setCredential,
  type CredentialRow,
} from "../lib/embeddings/store";
import { clearSdkCache } from "../lib/world-db";

const namespaceParam = z.object({
  namespace: z.string().openapi({
    param: { name: "namespace", in: "path", required: true },
  }),
});

/** Printable ASCII, no whitespace: also rules out header injection. */
const API_KEY_PATTERN = /^[\x21-\x7e]{16,512}$/;

function credentialResource(row: CredentialRow) {
  return {
    provider: row.provider as "openai",
    status: row.status,
    fingerprint: row.fingerprint,
    last4: row.last4,
    createTime: row.create_time,
    rotateTime: row.rotate_time ?? undefined,
    revokeTime: row.revoke_time ?? undefined,
  };
}

const notFound = {
  error: { code: "NOT_FOUND", message: "No embedding credential" },
};

/**
 * Namespace-level access. A world-scoped token is refused regardless of scope
 * (design 2.3), and the namespace always comes from the token, never the body.
 */
function guard(
  auth: Awaited<ReturnType<typeof authorize>>,
  namespace: string,
): Response | null {
  if (!auth.admin && !auth.namespace) return unauthorized();
  if (!auth.admin && auth.worldId) return forbidden();
  return requireAccess(auth, namespace, undefined, SCOPE_EMBEDDINGS_ADMIN);
}

const errorContent = {
  "application/json": { schema: ErrorResponseSchema },
};

const putRoute = createRoute({
  method: "put",
  path: "/namespaces/{namespace}/embedding-credential",
  tags: ["Embeddings"],
  operationId: "setEmbeddingCredential",
  summary: "Set embedding credential",
  description:
    "Store or rotate the namespace's embedding provider API key (bring your own key). The key is encrypted at rest with a key held only as a Worker secret and is write-only: it is never returned or logged. Requires the embeddings:admin scope (or an admin key); world-scoped tokens are refused. Returns 503 EMBEDDINGS_NOT_CONFIGURED when the deployment has no key-encryption key.",
  "x-mint": { metadata: { title: "Set embedding credential" } },
  security: [{ bearerWorldsToken: [] }],
  request: {
    params: namespaceParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: EmbeddingCredentialRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Credential stored; metadata only",
      content: { "application/json": { schema: EmbeddingCredentialSchema } },
    },
    400: { description: "Bad request", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Forbidden", content: errorContent },
    503: {
      description: "Embeddings are not configured on this deployment",
      content: errorContent,
    },
  },
});

const getRouteDef = createRoute({
  method: "get",
  path: "/namespaces/{namespace}/embedding-credential",
  tags: ["Embeddings"],
  operationId: "getEmbeddingCredential",
  summary: "Get embedding credential status",
  description:
    "Returns the namespace embedding credential's metadata (provider, status, fingerprint, last four characters, timestamps). The key itself is never returned. Requires the embeddings:admin scope.",
  "x-mint": { metadata: { title: "Get embedding credential status" } },
  security: [{ bearerWorldsToken: [] }],
  request: { params: namespaceParam },
  responses: {
    200: {
      description: "Credential metadata",
      content: { "application/json": { schema: EmbeddingCredentialSchema } },
    },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Forbidden", content: errorContent },
    404: { description: "No credential", content: errorContent },
  },
});

const deleteRouteDef = createRoute({
  method: "delete",
  path: "/namespaces/{namespace}/embedding-credential",
  tags: ["Embeddings"],
  operationId: "deleteEmbeddingCredential",
  summary: "Revoke embedding credential",
  description:
    "Revokes the namespace's embedding credential: the ciphertext is erased and worlds in the namespace fall back to keyword-only search (embeddingStatus no_credential). Every world in the namespace is marked stale, so after a new key is set search stays keyword-only until each world is reindexed (vectors built before the revoke are never trusted again). Requires the embeddings:admin scope.",
  "x-mint": { metadata: { title: "Revoke embedding credential" } },
  security: [{ bearerWorldsToken: [] }],
  request: { params: namespaceParam },
  responses: {
    204: { description: "Revoked" },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Forbidden", content: errorContent },
    404: { description: "No credential", content: errorContent },
  },
});

export function registerEmbeddingRoutes(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(putRoute, async (c) => {
    const env = c.env as unknown as Env;
    const namespace = c.req.param("namespace");
    const auth = await authorize(c.req.raw, env);
    const denied = guard(auth, namespace);
    if (denied) return denied;

    const body = c.req.valid("json");
    if (!API_KEY_PATTERN.test(body.apiKey)) {
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message:
              "apiKey must be 16-512 printable characters with no whitespace",
          },
        },
        400,
      );
    }

    const result = await setCredential(
      env,
      namespace,
      body.provider,
      body.apiKey,
    );
    if (!result.ok) {
      return respond(
        c,
        {
          error: {
            code: "EMBEDDINGS_NOT_CONFIGURED",
            message: "Embedding credentials are not enabled on this deployment",
          },
        },
        503,
      );
    }
    // Cached SDKs may hold an embedder resolved against the old credential.
    clearSdkCache();
    return respond(c, credentialResource(result.row));
  });

  app.openapi(getRouteDef, async (c) => {
    const env = c.env as unknown as Env;
    const namespace = c.req.param("namespace");
    const auth = await authorize(c.req.raw, env);
    const denied = guard(auth, namespace);
    if (denied) return denied;

    const row = await getCredential(env, namespace);
    if (!row) return respond(c, notFound, 404);
    return respond(c, credentialResource(row));
  });

  app.openapi(deleteRouteDef, async (c) => {
    const env = c.env as unknown as Env;
    const namespace = c.req.param("namespace");
    const auth = await authorize(c.req.raw, env);
    const denied = guard(auth, namespace);
    if (denied) return denied;

    const row = await getCredential(env, namespace);
    if (!row) return respond(c, notFound, 404);
    await revokeCredential(env, namespace);
    clearSdkCache();
    return c.body(null, 204) as any;
  });
}
