import { createRoute, z } from "@hono/zod-openapi";
import {
  SearchRequestSchema,
  SearchResponseSchema,
  worldIdParam,
} from "../../lib/schemas";

export const searchRoute = createRoute({
  method: "post",
  path: "/worlds/{worldId}/search",
  tags: ["Search"],
  operationId: "searchWorld",
  summary: "Search world",
  description:
    "Full-text and vector similarity search across a world's graph data. Returns ranked results with id, subject, predicate, content, score, and scoreType on the normalized 0–1 scale, plus the mode that actually ran. Falls back to LIKE-based search if the primary engine is unavailable.",
  "x-mint": { metadata: { title: "Search world" } },
  security: [{ bearerWorldsToken: [] }],
  request: {
    params: worldIdParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: SearchRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Search results",
      content: {
        "application/json": { schema: SearchResponseSchema },
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
  },
});
