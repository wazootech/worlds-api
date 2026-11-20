import { createRoute, z } from "@hono/zod-openapi";
import {
  PauseWorldRequestSchema,
  worldIdParam,
  WorldResourceSchema,
} from "../../lib/schemas";

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

export const pauseRoute = createRoute({
  method: "post",
  path: "/worlds/{worldId}/pause",
  tags: ["Worlds"],
  operationId: "pauseWorld",
  summary: "Pause world",
  description:
    "Pause a world with a mandatory time limit, blocking all read and write operations. The world auto-resumes when the time limit ends. This is the self-service action; indefinite suspension is control-plane only (POST /worlds/{worldId}/suspend).",
  "x-mint": { metadata: { title: "Pause world" } },
  security: [{ bearerWorldsToken: [] }],
  request: {
    params: worldIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: PauseWorldRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Paused World",
      content: {
        "application/json": { schema: WorldResourceSchema },
      },
    },
    400: {
      description: "Invalid pause duration",
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
