import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../env";
import { authorize, requireAccess, unauthorized } from "../lib/auth";
import { SCOPE_DATA_READ } from "../lib/auth";
import {
  sparqlMaxQueryLength,
  sparqlMaxResults,
  sparqlTimeoutMs,
} from "../lib/abuse";
import { resolveWorldDatabase, getWorldSdk } from "../lib/world-db";
import { respond } from "../lib/respond";
import { SparqlRequestSchema, worldIdParam } from "../lib/schemas";

/**
 * The engine rejects timeouts with this exact message (WazooSparqlEngine's
 * composed timeout/abort controller), so the
 * route maps it back to the documented QUERY_TIMEOUT error code without its
 * own timer.
 */
const SPARQL_TIMEOUT_MESSAGE = "SPARQL query timed out";

/**
 * materializeBindings drains SPARQL bindings before the response is
 * serialized. Engines may hand back a live stream; stream-evaluation errors
 * (e.g. an unhandled term comparator while sorting on an unbound OPTIONAL
 * variable) otherwise fire asynchronously during JSON serialization and
 * escape the route's try/catch, crashing the Worker with Error 1101.
 * Draining here turns those errors into a rejection the route can map to a
 * structured response.
 */
async function materializeBindings(
  bindings: unknown,
  maxRows: number,
): Promise<unknown> {
  if (Array.isArray(bindings)) return bindings.slice(0, maxRows);
  const iterable = bindings as
    | {
        [Symbol.asyncIterator](): AsyncIterator<unknown>;
      }
    | undefined;
  if (iterable && typeof iterable[Symbol.asyncIterator] === "function") {
    const rows: unknown[] = [];
    for await (const row of iterable as AsyncIterable<unknown>) {
      rows.push(row);
      if (rows.length >= maxRows) break; // bound drain cost
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
      description:
        "Always returns 400. Use POST /worlds/{id}/sparql to execute a SPARQL query against a specific world.",
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
      description:
        "Execute a SPARQL 1.1 query (SELECT, ASK, or UPDATE) against a world's RDF graph. SELECT results are limited by the server-configured maximum. Queries time out after the configured limit.",
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

      const accessErr = requireAccess(
        auth,
        ref.namespace,
        worldUid,
        SCOPE_DATA_READ,
      );
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

      const maxQueryLength = sparqlMaxQueryLength(env);
      if (body.query.length > maxQueryLength) {
        return respond(
          c,
          {
            error: {
              code: "QUERY_TOO_LARGE",
              message: `SPARQL query exceeds the ${maxQueryLength} character limit`,
            },
          },
          400,
        );
      }

      const client = await getWorldSdk(env, ref);

      try {
        // The engine composes the caller signal with the timeout into one
        // controller (first wins) and clears its timer on completion, so the
        // route no longer races a second timer. The signal forwards the
        // client disconnect (c.req.raw.signal) so an in-flight query aborts
        // at the next evaluation boundary instead of burning a Worker slot.
        const result = await client.sparql({
          query: body.query,
          signal: c.req.raw.signal,
          timeoutMs: sparqlTimeoutMs(env),
        });
        if (result.kind === "select") {
          const data = {
            ...result.data,
            results: {
              ...result.data.results,
              bindings: await materializeBindings(
                result.data.results.bindings,
                sparqlMaxResults(env),
              ),
            },
          };
          return respond(c, data);
        }
        if (result.kind === "ask") {
          return respond(c, result.data);
        }
        if (result.kind === "void") {
          return respond(c, { ok: true });
        }
        return respond(
          c,
          {
            error: {
              code: "UNSUPPORTED_QUERY_KIND",
              message:
                "Unsupported SPARQL result. Use a SELECT, ASK, or SPARQL UPDATE query.",
            },
          },
          400,
        );
      } catch (error) {
        // Client disconnect: the request signal fired, so the response can
        // never be delivered. Return an empty body rather than serializing a
        // pointless error to a dead connection.
        if (c.req.raw.signal.aborted) {
          return c.body(null);
        }
        if (
          error instanceof Error &&
          error.message === SPARQL_TIMEOUT_MESSAGE
        ) {
          return respond(
            c,
            {
              error: {
                code: "QUERY_TIMEOUT",
                message: SPARQL_TIMEOUT_MESSAGE,
              },
            },
            400,
          );
        }
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
