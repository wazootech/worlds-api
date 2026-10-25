import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../env";
import { authorize, requireAccess, unauthorized } from "../lib/auth";
import { SCOPE_DATA_READ, SCOPE_DATA_WRITE } from "../lib/auth";
import { SparqlParser } from "@wazoo/sparql-engine/parser";
import {
  sparqlMaxQueryLength,
  sparqlMaxResults,
  sparqlTimeoutMs,
} from "../lib/abuse";
import { resolveWorldDatabase, getWorldSdk } from "../lib/world-db";
import { respond } from "../lib/respond";
import {
  ErrorResponseSchema,
  SparqlRequestSchema,
  worldIdParam,
} from "../lib/schemas";
import { writeBudgetError, writeBudgetExceeded } from "../lib/write-budget";
import {
  cleanupOk,
  cleanupWorldVectors,
  markWorldStale,
  type VectorCleanupReport,
} from "../lib/embeddings/vectors";

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
 * (e.g., an unhandled term comparator while sorting on an unbound OPTIONAL
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

/**
 * Parses the query with the same parser configuration the engine uses and
 * reports whether it is a query or an update. Throws on a syntax error.
 */
function classifySparql(query: string): "query" | "update" {
  return new SparqlParser().parse(query).type;
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
    }),
    async (c) => {
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "Use /worlds/:worldId/sparql to query one World",
          },
        },
        400,
      );
    },
  );

  app.openapi(
    createRoute({
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
    }),
    async (c) => {
      const env = c.env as unknown as Env;
      const worldId = c.req.param("worldId");
      const auth = await authorize(c.req.raw, env);
      const body = c.req.valid("json");

      if (!auth.admin && !auth.namespace) return unauthorized();

      const ref = await resolveWorldDatabase(env, worldId);
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

      // Namespace and world first, so a foreign key learns nothing about the
      // query; the scope check waits until the query is classified below.
      const ownerErr = requireAccess(auth, ref.namespace, worldId);
      if (ownerErr) return ownerErr;

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

      // Classify before authorizing: an update mutates the world, so it needs
      // data:write like import. Deciding from the result kind would be too
      // late, since the update has already run by then.
      let isUpdate: boolean;
      try {
        isUpdate = classifySparql(body.query) === "update";
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

      const accessErr = requireAccess(
        auth,
        ref.namespace,
        worldId,
        isUpdate ? SCOPE_DATA_WRITE : SCOPE_DATA_READ,
      );
      if (accessErr) return accessErr;

      if (isUpdate && (await writeBudgetExceeded(env, ref.namespace))) {
        return respond(c, writeBudgetError(env), 429);
      }

      const client = await getWorldSdk(env, ref);

      try {
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
          // The engine deletes quads but leaves their chunk rows, and with
          // them the vectors whose Vectorize metadata carries the removed
          // text. Remove those vectors (and the orphaned chunk rows) now;
          // failures are reported and fail safe by marking the world stale.
          const vectorCleanup = await reconcileAfterUpdate(env, worldId);
          return respond(c, {
            ok: true,
            ...(vectorCleanup && { vectorCleanup }),
          });
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

/**
 * Post-update vector reconciliation. Never throws: the update is already
 * committed, so a failure is reported in the response and logged, and the
 * world is marked stale so search cannot serve text whose vector could not be
 * removed (reindex retries the cleanup). Returns undefined when there was
 * nothing to do (no Vectorize binding, or no orphaned vectors).
 */
async function reconcileAfterUpdate(
  env: Env,
  worldId: string,
): Promise<VectorCleanupReport | undefined> {
  try {
    const report = await cleanupWorldVectors(env, worldId, "orphans");
    if (!report.enabled) return undefined;
    if (!cleanupOk(report)) {
      console.warn("vector cleanup after update incomplete", {
        worldId,
        failed: report.failed,
        incomplete: report.incomplete,
        errors: report.errors,
      });
      await markWorldStale(env, worldId).catch(() => {});
      return report;
    }
    return report.attempted > 0 || report.orphanChunkRows > 0
      ? report
      : undefined;
  } catch (error) {
    console.warn("vector cleanup after update failed", {
      worldId,
      reason: error instanceof Error ? error.name : "unknown",
    });
    await markWorldStale(env, worldId).catch(() => {});
    return {
      enabled: true,
      attempted: 0,
      deleted: 0,
      failed: 1,
      incomplete: false,
      orphanChunkRows: 0,
      errors: ["cleanup: failed"],
    };
  }
}
