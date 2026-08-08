import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { QueryEngine } from "@comunica/query-sparql-rdfjs-lite";
import { createLibsqlClient } from "@worlds/libsql";
import type { Env } from "../env";
import { authorize, requireAccess, unauthorized } from "../lib/auth";
import { resolveWorldDatabase, worldDb } from "../lib/world-db";
import { respond } from "../lib/respond";
import { SparqlRequestSchema, worldIdParam } from "../lib/schemas";

const queryEngine = new QueryEngine();

/**
 * materializeBindings drains SPARQL bindings before the response is
 * serialized. Comunica may hand back a live event stream; stream-evaluation
 * errors (e.g. an unhandled term comparator while sorting on an unbound
 * OPTIONAL variable) otherwise fire asynchronously during JSON serialization
 * and escape the route's try/catch, crashing the Worker with Error 1101.
 * Draining here turns those errors into a rejection the route can map to a
 * structured response.
 */
async function materializeBindings(bindings: unknown): Promise<unknown> {
  if (Array.isArray(bindings)) return bindings;
  const iterable = bindings as
    { [Symbol.asyncIterator](): AsyncIterator<unknown> } | undefined;
  if (iterable && typeof iterable[Symbol.asyncIterator] === "function") {
    const rows: unknown[] = [];
    for await (const row of iterable as AsyncIterable<unknown>) {
      rows.push(row);
    }
    return rows;
  }
  return bindings;
}

export function registerSparqlRoutes(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(
    createRoute({
      method: "post",
      path: "/worlds/sparql",
      tags: ["SPARQL"],
      operationId: "sparqlNoWorld",
      summary: "SPARQL without world",
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
    }),
    async (c) => {
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "Use /worlds/:id/sparql to query one World",
          },
        },
        400,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/worlds/{id}/sparql",
      tags: ["SPARQL"],
      operationId: "sparqlWorld",
      summary: "Execute SPARQL query",
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
      },
    }),
    async (c) => {
      const env = c.env as unknown as Env;
      const worldUid = c.req.param("id");
      const auth = await authorize(c.req.raw, env);
      const body = c.req.valid("json");

      if (!auth.admin && !auth.namespace) return unauthorized();

      const ref = await resolveWorldDatabase(env, worldUid);
      if (!ref) {
        return respond(
          c,
          {
            error: {
              code: "NOT_FOUND",
              message: "World database not found",
            },
          },
          404,
        );
      }

      const accessErr = requireAccess(auth, ref.namespace, worldUid);
      if (accessErr) return accessErr;

      if (!body.query) {
        return respond(
          c,
          {
            error: { code: "INVALID_ARGUMENT", message: "query is required" },
          },
          400,
        );
      }

      const db = worldDb(ref);
      const client = await createLibsqlClient({
        client: db,
        queryEngine,
      });

      try {
        const result = await client.sparql({ query: body.query });
        if (result.kind === "select") {
          const data = {
            ...result.data,
            results: {
              ...result.data.results,
              bindings: await materializeBindings(result.data.results.bindings),
            },
          };
          return respond(c, data);
        }
        if (result.kind === "ask") {
          return respond(c, result.data);
        }
        return respond(c, { ok: true });
      } catch (error) {
        return respond(
          c,
          {
            error: {
              code: "INVALID_ARGUMENT",
              message:
                error instanceof Error ? error.message : "Invalid SPARQL query",
            },
          },
          400,
        );
      }
    },
  );
}
