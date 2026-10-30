import { createRoute, z } from "@hono/zod-openapi";
import {
  ApiKeyCreateRequestSchema,
  ApiKeyCreateResponseSchema,
  ApiKeyResourceSchema,
  apiKeysListQuery,
  keyIdParam,
} from "../../lib/schemas";

export const createApiKeyRoute = createRoute({
  method: "post",
  path: "/api-keys",
  tags: ["APIKeys"],
  operationId: "createApiKey",
  summary: "Create API key",
  description:
    "Create a new API key scoped to a namespace and optionally a single world. The token is returned once on creation and cannot be retrieved again.",
  "x-mint": { metadata: { title: "Create API key" } },
  security: [{ bearerWorldsToken: [] }],
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: ApiKeyCreateRequestSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Created API key",
      content: {
        "application/json": { schema: ApiKeyCreateResponseSchema },
      },
    },
    400: {
      description: "Bad request",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
    403: {
      description: "Forbidden",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
  },
});

export const listApiKeysRoute = createRoute({
  method: "get",
  path: "/api-keys",
  tags: ["APIKeys"],
  operationId: "listApiKeys",
  summary: "List API keys",
  description:
    "List all active (non-revoked) API keys. Optionally filter by namespace. Admin-only.",
  "x-mint": { metadata: { title: "List API keys" } },
  security: [{ bearerWorldsToken: [] }],
  request: { query: apiKeysListQuery },
  responses: {
    200: {
      description: "API keys list",
      content: {
        "application/json": {
          schema: z.object({ keys: z.array(ApiKeyResourceSchema) }),
        },
      },
    },
    403: {
      description: "Forbidden",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
  },
});

export const deleteApiKeyRoute = createRoute({
  method: "delete",
  path: "/api-keys/{keyId}",
  tags: ["APIKeys"],
  operationId: "deleteApiKey",
  summary: "Revoke API key",
  description:
    "Permanently revoke an API key. The key immediately loses all access. This action cannot be undone.",
  "x-mint": { metadata: { title: "Revoke API key" } },
  request: { params: keyIdParam },
  responses: {
    204: { description: "Revoked" },
    403: {
      description: "Forbidden",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
    404: {
      description: "Not found",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
  },
});
