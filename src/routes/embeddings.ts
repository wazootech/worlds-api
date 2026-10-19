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
  EmbeddingProviderListSchema,
  ErrorResponseSchema,
} from "../lib/schemas";
import {
  EMBEDDING_PROVIDER_IDS,
  type EmbeddingProviderId,
} from "../lib/embeddings/catalog";
import {
  getCredential,
  listCredentials,
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

const providerParam = namespaceParam.extend({
  provider: z.enum(EMBEDDING_PROVIDER_IDS).openapi({
    param: { name: "provider", in: "path", required: true },
    description:
      "Embedding provider whose credential this addresses. A namespace holds at most one credential per provider.",
  }),
});

/** Printable ASCII, no whitespace: also rules out header injection. */
const API_KEY_PATTERN = /^[\x21-\x7e]{16,512}$/;

function credentialResource(row: CredentialRow) {
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

const listRouteDef = createRoute({
  method: "get",
  path: "/namespaces/{namespace}/embedding-providers",
  tags: ["Embeddings"],
  operationId: "listEmbeddingProviders",
  summary: "List embedding providers",
  description:
    "Lists the namespace's embedding provider credentials, newest first, revoked ones included so their status stays readable. Metadata only: no key is ever returned. Requires the embeddings:admin scope.",
  "x-mint": { metadata: { title: "List embedding providers" } },
  security: [{ bearerWorldsToken: [] }],
  request: { params: namespaceParam },
  responses: {
    200: {
      description: "Credential metadata, one entry per provider",
      content: { "application/json": { schema: EmbeddingProviderListSchema } },
    },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Forbidden", content: errorContent },
  },
});

const putRoute = createRoute({
  method: "put",
  path: "/namespaces/{namespace}/embedding-providers/{provider}",
  tags: ["Embeddings"],
  operationId: "setEmbeddingProviderCredential",
  summary: "Set embedding provider credential",
  description:
    "Store or rotate the namespace's API key for one embedding provider (bring your own key). The key is encrypted at rest with a key held only as a Worker secret and is write-only: it is never returned or logged. Requires the embeddings:admin scope (or an admin key); world-scoped tokens are refused. Returns 503 EMBEDDINGS_NOT_CONFIGURED when the deployment has no key-encryption key.",
  "x-mint": { metadata: { title: "Set embedding provider credential" } },
  security: [{ bearerWorldsToken: [] }],
  request: {
    params: providerParam,
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
  path: "/namespaces/{namespace}/embedding-providers/{provider}",
  tags: ["Embeddings"],
  operationId: "getEmbeddingProviderCredential",
  summary: "Get embedding provider credential status",
  description:
    "Returns the metadata of the namespace's credential for one provider (status, fingerprint, last four characters, timestamps). The key itself is never returned. Requires the embeddings:admin scope.",
  "x-mint": { metadata: { title: "Get embedding provider credential status" } },
  security: [{ bearerWorldsToken: [] }],
  request: { params: providerParam },
  responses: {
    200: {
      description: "Credential metadata",
      content: { "application/json": { schema: EmbeddingCredentialSchema } },
    },
    400: { description: "Bad request", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Forbidden", content: errorContent },
    404: { description: "No credential", content: errorContent },
  },
});

const deleteRouteDef = createRoute({
  method: "delete",
  path: "/namespaces/{namespace}/embedding-providers/{provider}",
  tags: ["Embeddings"],
  operationId: "deleteEmbeddingProviderCredential",
  summary: "Revoke embedding provider credential",
  description:
    "Revokes the namespace's credential for one provider: the ciphertext is erased and worlds on that provider's models fall back to keyword-only search (embeddingStatus no_credential). Every world on that provider's models is marked stale (worlds on another provider's models are untouched), so after a new key is set search stays keyword-only until each world is reindexed (vectors built before the revoke are never trusted again). Requires the embeddings:admin scope.",
  "x-mint": { metadata: { title: "Revoke embedding provider credential" } },
  security: [{ bearerWorldsToken: [] }],
  request: { params: providerParam },
  responses: {
    204: { description: "Revoked" },
    400: { description: "Bad request", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Forbidden", content: errorContent },
    404: { description: "No credential", content: errorContent },
  },
});

export function registerEmbeddingRoutes(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(listRouteDef, async (c) => {
    const env = c.env as unknown as Env;
    const namespace = c.req.param("namespace");
    const auth = await authorize(c.req.raw, env);
    const denied = guard(auth, namespace);
    if (denied) return denied;

    const rows = await listCredentials(env, namespace);
    return respond(c, { providers: rows.map(credentialResource) });
  });

  app.openapi(putRoute, async (c) => {
    const env = c.env as unknown as Env;
    const { namespace, provider } = c.req.valid("param");
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

    const result = await setCredential(env, namespace, provider, body.apiKey);
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
    const { namespace, provider } = c.req.valid("param");
    const auth = await authorize(c.req.raw, env);
    const denied = guard(auth, namespace);
    if (denied) return denied;

    const row = await getCredential(env, namespace, provider);
    if (!row) return respond(c, notFound, 404);
    return respond(c, credentialResource(row));
  });

  app.openapi(deleteRouteDef, async (c) => {
    const env = c.env as unknown as Env;
    const { namespace, provider } = c.req.valid("param");
    const auth = await authorize(c.req.raw, env);
    const denied = guard(auth, namespace);
    if (denied) return denied;

    const row = await getCredential(env, namespace, provider);
    if (!row) return respond(c, notFound, 404);
    await revokeCredential(env, namespace, provider);
    clearSdkCache();
    return c.body(null, 204) as any;
  });
}
