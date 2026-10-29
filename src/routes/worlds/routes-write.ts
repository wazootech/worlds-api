import { createRoute, z } from "@hono/zod-openapi";
import {
  CreateWorldRequestSchema,
  UpdateWorldRequestSchema,
  worldIdParam,
  WorldResourceSchema,
} from "../../lib/schemas";

export const createRouteDef = createRoute({
  method: "post",
  path: "/worlds",
  tags: ["Worlds"],
  operationId: "createWorld",
  summary: "Create world",
  description:
    "Create a new World metadata record in the shared D1 database. Worlds API mints its ID as w_<ULID>; callers cannot choose the ID or a slug.",
  "x-mint": { metadata: { title: "Create world" } },
  security: [{ bearerWorldsToken: [] }],
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: CreateWorldRequestSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Created World",
      content: {
        "application/json": { schema: WorldResourceSchema },
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
    409: {
      description:
        "embeddingModel was given but the namespace has no active embedding credential (EMBEDDING_CREDENTIAL_REQUIRED).",
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

export const updateRoute = createRoute({
  method: "patch",
  path: "/worlds/{worldId}",
  tags: ["Worlds"],
  operationId: "updateWorld",
  summary: "Update world",
  description:
    "Update a world's display name, embedding model, or search configuration. Changing the embedding model marks the world stale (embeddingStatus stale): search runs keyword-only until POST /worlds/{worldId}/reindex is called. It does not reindex automatically, because reindexing spends the namespace's embedding budget. Setting a model requires an active embedding credential for the namespace.",
  "x-mint": { metadata: { title: "Update world" } },
  security: [{ bearerWorldsToken: [] }],
  request: {
    params: worldIdParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: UpdateWorldRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Updated World",
      content: {
        "application/json": { schema: WorldResourceSchema },
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
