import type { OpenAPIHono } from "@hono/zod-openapi";
import { serializeTurtle } from "@wazoo/sparql-engine";
import type { Env } from "../../env";
import {
  authorize,
  requireAccess,
  SCOPE_DATA_READ,
  unauthorized,
} from "../../lib/auth";
import { getWorldSdk, resolveWorldDatabase } from "../../lib/world-db";
import { respond } from "../../lib/respond";
import {
  serializeQuadsToJsonLd,
  serializeQuadsToTrig,
} from "../../lib/export-serializers";
import {
  DEFAULT_EXPORT_LIMIT,
  EXPORT_FORMATS,
  TURTLE_FORMATS,
  type ExportFormat,
  type TurtleExportFormat,
} from "./constants";
import { exportRoute } from "./export-route";

export function registerExport(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(exportRoute, async (c) => {
    const env = c.env as unknown as Env;
    const worldId = c.req.param("worldId");
    const auth = await authorize(c.req.raw, env);
    const query = c.req.valid("query");

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

    const accessErr = requireAccess(
      auth,
      ref.namespace,
      worldId,
      SCOPE_DATA_READ,
    );
    if (accessErr) return accessErr;

    const fmt = query.format ?? "application/json";
    // JSON and text chunks have always paged by default. Serialized RDF
    // formats return the whole world when no limit is given, as they did
    // before #103, so existing full-file exports (the console's download)
    // keep working; an explicit limit pages them like every other format.
    const pagesByDefault = fmt === "application/json" || fmt === "text/plain";
    const limit =
      query.limit !== undefined
        ? Number(query.limit)
        : pagesByDefault
          ? DEFAULT_EXPORT_LIMIT
          : Number.MAX_SAFE_INTEGER;
    const offset = Number(query.offset ?? "0");
    if (!Number.isInteger(limit) || limit < 1) {
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "limit must be a positive integer",
          },
        },
        400,
      );
    }
    if (!Number.isInteger(offset) || offset < 0) {
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "offset must be a non-negative integer",
          },
        },
        400,
      );
    }
    if (!EXPORT_FORMATS.includes(fmt as ExportFormat)) {
      return respond(
        c,
        {
          error: {
            code: "UNSUPPORTED_FORMAT",
            message: `Export format '${fmt}' is not supported. Use ${EXPORT_FORMATS.map((f) => `'${f}'`).join(", ")}.`,
          },
        },
        400,
      );
    }

    // Every format honors limit/offset the same way (#103): read the quads
    // once, take the [offset, offset + limit) slice, and serialize only it.
    // X-Next-Offset is set whenever more data remains, so serialized
    // formats (whose bodies cannot carry a JSON field) signal it too.
    const client = await getWorldSdk(env, ref);
    const exported = await client.export({ format: { kind: "quads" } });
    const all = exported.kind === "quads" ? exported.quads : [];
    const source =
      fmt === "text/plain"
        ? all.filter((q) => q.predicate.value === "http://schema.org/text")
        : all;
    const page = source.slice(offset, offset + limit);
    const nextOffset =
      source.length > offset + limit ? offset + limit : undefined;
    const pagingHeaders: Record<string, string> =
      nextOffset === undefined ? {} : { "X-Next-Offset": String(nextOffset) };

    if (fmt === "application/json") {
      if (nextOffset !== undefined) {
        c.header("X-Next-Offset", String(nextOffset));
      }
      return respond(c, {
        quads: page.map((q) => ({
          subject: q.subject.value,
          predicate: q.predicate.value,
          object: q.object.value,
          graph:
            q.graph.termType === "DefaultGraph" ? undefined : q.graph.value,
        })),
        nextOffset,
      });
    }
    const body =
      fmt === "text/plain"
        ? page.map((q) => `${q.subject.value}\t${q.object.value}`).join("\n")
        : fmt === "application/trig"
          ? serializeQuadsToTrig(page)
          : fmt === "application/ld+json"
            ? serializeQuadsToJsonLd(page)
            : serializeTurtle(page, {
                format: TURTLE_FORMATS[fmt as TurtleExportFormat],
              });
    return c.text(body, 200, { "Content-Type": fmt, ...pagingHeaders });
  });
}
