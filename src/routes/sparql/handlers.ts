import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../../env";
import {
  authorize,
  requireAccess,
  SCOPE_DATA_READ,
  SCOPE_DATA_WRITE,
  unauthorized,
} from "../../lib/auth";
import { sparqlMaxQueryLength } from "../../lib/abuse";
import { getWorldSdk, resolveWorldDatabase } from "../../lib/world-db";
import { respond } from "../../lib/respond";
import { writeBudgetRefusal } from "../../lib/write-budget";
import { executeSparql } from "./execute";
import { classifySparql } from "./helpers";
import { sparqlNoWorldRoute, sparqlWorldRoute } from "./routes";

export function registerSparqlNoWorld(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(sparqlNoWorldRoute, async (c) => {
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
  });
}

export function registerSparqlWorld(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(sparqlWorldRoute, async (c) => {
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

    const refusal = isUpdate
      ? await writeBudgetRefusal(env, ref.namespace)
      : null;
    if (refusal) {
      return respond(c, refusal, 429);
    }

    const client = await getWorldSdk(env, ref);
    return executeSparql(c, env, client, worldId, body.query);
  });
}
