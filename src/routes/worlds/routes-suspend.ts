import { createRoute, z } from "@hono/zod-openapi";
import { worldIdParam, WorldResourceSchema } from "../../lib/schemas";

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
