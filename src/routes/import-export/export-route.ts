import { createRoute, z } from "@hono/zod-openapi";
import {
  ExportQuadsResponseSchema,
  exportQuery,
  worldIdParam,
} from "../../lib/schemas";

export const exportRoute = createRoute({
  method: "get",
  path: "/worlds/{worldId}/export",
  tags: ["ImportExport"],
  operationId: "exportWorld",
  summary: "Export graph data",
  description:
    "Export RDF quads from a world. Supports JSON (RDF/JSON array), Turtle, TriG, and JSON-LD output formats. Use the limit and offset query parameters for pagination.",
  "x-mint": { metadata: { title: "Export graph data" } },
  security: [{ bearerWorldsToken: [] }],
  request: {
    params: worldIdParam,
    query: exportQuery,
  },
  responses: {
    200: {
      description: "Export result",
      content: {
        "application/json": { schema: ExportQuadsResponseSchema },
        "text/plain": { schema: z.any() },
        "application/n-quads": { schema: z.any() },
        "application/n-triples": { schema: z.any() },
        "text/turtle": { schema: z.any() },
        "application/trig": { schema: z.any() },
        "application/ld+json": { schema: z.any() },
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
