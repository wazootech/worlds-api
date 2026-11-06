import { createRoute, z } from "@hono/zod-openapi";
import { worldIdParam, WorldResourceSchema } from "../../lib/schemas";

export const deleteRoute = createRoute({
  method: "delete",
  path: "/worlds/{worldId}",
  tags: ["Worlds"],
  operationId: "deleteWorld",
  summary: "Delete world",
  description:
    "Soft-delete a world. The world enters a 30-day grace period during which it can be restored via undelete. After the grace period, the world is permanently purged.",
  "x-mint": { metadata: { title: "Delete world" } },
  security: [{ bearerWorldsToken: [] }],
  request: { params: worldIdParam },
  responses: {
    204: { description: "Deleted" },
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

export const undeleteRoute = createRoute({
  method: "post",
  path: "/worlds/{worldId}/undelete",
  tags: ["Worlds"],
  operationId: "undeleteWorld",
  summary: "Undelete world",
  description:
    "Restore a soft-deleted world within its 30-day grace period. Returns the restored WorldResource. Fails if the grace period has expired.",
  "x-mint": { metadata: { title: "Undelete world" } },
  security: [{ bearerWorldsToken: [] }],
  request: { params: worldIdParam },
  responses: {
    200: {
      description: "Restored World",
      content: {
        "application/json": { schema: WorldResourceSchema },
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
    409: {
      description: "Restore blocked",
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

export const suspendRoute = createRoute({
  method: "post",
  path: "/worlds/{worldId}/suspend",
  tags: ["Worlds"],
  operationId: "suspendWorld",
  summary: "Suspend world",
  description:
    "Suspend a world, temporarily blocking all read and write operations. The world can be resumed later without data loss.",
  "x-mint": { metadata: { title: "Suspend world" } },
  security: [{ bearerWorldsToken: [] }],
  request: { params: worldIdParam },
  responses: {
    200: {
      description: "Suspended World",
      content: {
        "application/json": { schema: WorldResourceSchema },
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

export const resumeRoute = createRoute({
  method: "post",
  path: "/worlds/{worldId}/resume",
  tags: ["Worlds"],
  operationId: "resumeWorld",
  summary: "Resume world",
  description:
    "Resume a suspended world, restoring full read and write access.",
  "x-mint": { metadata: { title: "Resume world" } },
  security: [{ bearerWorldsToken: [] }],
  request: { params: worldIdParam },
  responses: {
    200: {
      description: "Resumed World",
      content: {
        "application/json": { schema: WorldResourceSchema },
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
