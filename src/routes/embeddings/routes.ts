import { createRoute } from "@hono/zod-openapi";
import {
  EmbeddingCredentialRequestSchema,
  EmbeddingCredentialSchema,
  EmbeddingProviderListSchema,
} from "../../lib/schemas";
import { errorContent, namespaceParam, providerParam } from "./shared";

export const listRouteDef = createRoute({
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

export const putRoute = createRoute({
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

export const getRouteDef = createRoute({
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

export const deleteRouteDef = createRoute({
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
