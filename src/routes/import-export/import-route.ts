import { createRoute, z } from "@hono/zod-openapi";
import {
  ErrorResponseSchema,
  ImportRequestSchema,
  ImportResponseSchema,
  worldIdParam,
} from "../../lib/schemas";

export const importRoute = createRoute({
  method: "post",
  path: "/worlds/{worldId}/import",
  tags: ["ImportExport"],
  operationId: "importWorld",
  summary: "Import graph data",
  description:
    "Import RDF data into a world. Accepts Turtle (the default), TriG, N-Triples, N-Quads, or N3 payloads; application/json quad rows; or text/plain chunks. Quads are stored in the world's Cloudflare D1 database and indexed for vector search.",
  "x-mint": { metadata: { title: "Import graph data" } },
  security: [{ bearerWorldsToken: [] }],
  request: {
    params: worldIdParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: ImportRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Import result",
      content: {
        "application/json": { schema: ImportResponseSchema },
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
    429: {
      description:
        "The namespace has used its daily database write budget (WRITE_BUDGET_EXCEEDED). Nothing was written; it resets at 00:00 UTC. Reads are unaffected.",
      content: {
        "application/json": { schema: ErrorResponseSchema },
      },
    },
  },
});
