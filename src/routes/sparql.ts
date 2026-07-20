import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { QueryEngine } from "@comunica/query-sparql-rdfjs-lite";
import { createLibsqlClient } from "@worlds/libsql";
import type { Env } from "../env";
import { authorize, requireAccess, unauthorized } from "../lib/auth";
import { resolveWorldDatabase, worldDb } from "../lib/world-db";
import { respond } from "../lib/respond";
import {
  SparqlRequestSchema,
  worldIdParam,
  namespaceQuery,
} from "../lib/schemas";

const queryEngine = new QueryEngine();

export function registerSparqlRoutes(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(
    createRoute({
      method: "post",
      path: "/worlds/sparql",
      tags: ["SPARQL"],
      operationId: "sparqlNoWorld",
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
      const worldId = c.req.param("id");
      const auth = await authorize(c.req.raw, env);
      const body = c.req.valid("json");
      const namespace = auth.admin
        ? (body.namespace ?? c.req.query("namespace"))
        : auth.namespace;
      if (!namespace) return unauthorized();

      const accessErr = requireAccess(auth, namespace, worldId);
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

      const ref = await resolveWorldDatabase(env, namespace, worldId);
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

      const db = worldDb(ref);
      const client = await createLibsqlClient({
        client: db,
        queryEngine,
      });

      try {
        const result = await client.sparql({ query: body.query });
        if (result.kind === "select" || result.kind === "ask") {
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
