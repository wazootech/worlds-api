import type { Context } from "hono";
import type { Env } from "../../env";
import { sparqlMaxResults, sparqlTimeoutMs } from "../../lib/abuse";
import type { getWorldSdk } from "../../lib/world-db";
import { respond } from "../../lib/respond";
import { materializeBindings, SPARQL_TIMEOUT_MESSAGE } from "./helpers";
import { reconcileAfterUpdate } from "./reconcile";

export async function executeSparql(
  c: Context,
  env: Env,
  client: Awaited<ReturnType<typeof getWorldSdk>>,
  worldId: string,
  query: string,
) {
  try {
    const result = await client.sparql({
      query: query,
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
    if (error instanceof Error && error.message === SPARQL_TIMEOUT_MESSAGE) {
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
}
