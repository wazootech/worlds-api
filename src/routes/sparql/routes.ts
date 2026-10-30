import { createRoute, z } from "@hono/zod-openapi";
import {
  ErrorResponseSchema,
  SparqlRequestSchema,
  worldIdParam,
} from "../../lib/schemas";

export const sparqlNoWorldRoute = createRoute({
  method: "post",
  path: "/worlds/sparql",
  tags: ["SPARQL"],
  operationId: "sparqlNoWorld",
  summary: "SPARQL without world",
  description:
    "Always returns 400. Use POST /worlds/{worldId}/sparql to execute a SPARQL query against a specific world.",
  "x-mint": { metadata: { title: "SPARQL without world" } },
  security: [{ bearerWorldsToken: [] }],
  responses: {
    400: {
      description: "Must specify a World",
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

export const sparqlWorldRoute = createRoute({
  method: "post",
  path: "/worlds/{worldId}/sparql",
  tags: ["SPARQL"],
  operationId: "sparqlWorld",
  summary: "Execute SPARQL query",
  description:
    "Execute a SPARQL 1.1 query (SELECT, ASK, or UPDATE) against a world's RDF graph. SELECT and ASK require the data:read scope; SPARQL UPDATE (INSERT, DELETE, CLEAR, DROP, and the other update forms) requires data:write, and a key without it receives 403 before the update runs. An unparseable query returns 400 INVALID_ARGUMENT. SELECT results are limited by the server-configured maximum. Queries time out after the configured limit.",
  "x-mint": { metadata: { title: "Execute SPARQL query" } },
  security: [{ bearerWorldsToken: [] }],
  request: {
    params: worldIdParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: SparqlRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "SPARQL query result",
      content: {
        "application/json": {
          schema: z.any(),
        },
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
