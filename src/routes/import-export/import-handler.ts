import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../../env";
import {
  authorize,
  requireAccess,
  SCOPE_DATA_WRITE,
  unauthorized,
} from "../../lib/auth";
import { maxImportQuads, maxImportBytes } from "../../lib/abuse";
import { getWorldSdk, resolveWorldDatabase } from "../../lib/world-db";
import { respond } from "../../lib/respond";
import { writeBudgetRefusal } from "../../lib/write-budget";
import { RDF_IMPORT_CONTENT_TYPES } from "./constants";
import { importJsonQuads, importTextChunks } from "./import-branches";
import { importRdf, unsupportedContentType } from "./import-rdf";
import { importRoute } from "./import-route";

export function registerImport(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(importRoute, async (c) => {
    const env = c.env as unknown as Env;
    const worldId = c.req.param("worldId");
    const auth = await authorize(c.req.raw, env);
    const body = c.req.valid("json");

    if (!auth.admin && !auth.namespace) return unauthorized();

    const bytesCap = maxImportBytes(env);
    const declaredLength = Number(c.req.header("content-length") ?? "0");
    if (declaredLength > bytesCap || body.data.length > bytesCap) {
      return respond(
        c,
        {
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: `Import payload exceeds the ${bytesCap} byte limit`,
          },
        },
        413,
      );
    }

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

    const accessErr = requireAccess(
      auth,
      ref.namespace,
      worldId,
      SCOPE_DATA_WRITE,
    );
    if (accessErr) return accessErr;
    const contentType = body.contentType ?? "text/turtle";

    if (!body.data) {
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "data field is required",
          },
        },
        400,
      );
    }

    const refusal = await writeBudgetRefusal(env, ref.namespace);
    if (refusal) {
      return respond(c, refusal, 429);
    }

    const client = await getWorldSdk(env, ref);

    const quadsCap = maxImportQuads(env);

    if (contentType === "application/json") {
      return importJsonQuads(c, client, body.data, quadsCap);
    }
    if (
      contentType === "text/plain" ||
      contentType === "application/x-ndjson"
    ) {
      return importTextChunks(c, client, body.data, quadsCap);
    }
    const mediaType = contentType.split(";")[0].trim().toLowerCase();
    if ((RDF_IMPORT_CONTENT_TYPES as readonly string[]).includes(mediaType)) {
      return importRdf(c, client, body.data, mediaType, quadsCap);
    }
    return unsupportedContentType(c, contentType);
  });
}
