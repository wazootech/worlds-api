import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../env";
import { authorize, requireAccess, unauthorized } from "../lib/auth";
import { SCOPE_DATA_READ, SCOPE_DATA_WRITE } from "../lib/auth";
import { maxImportBytes, maxImportQuads } from "../lib/abuse";
import { resolveWorldDatabase, getWorldSdk } from "../lib/world-db";
import { respond } from "../lib/respond";
import { writeBudgetRefusal } from "../lib/write-budget";
import {
  ErrorResponseSchema,
  ExportQuadsResponseSchema,
  exportQuery,
  ImportRequestSchema,
  ImportResponseSchema,
  worldIdParam,
} from "../lib/schemas";
import {
  serializeQuadsToJsonLd,
  serializeQuadsToTrig,
} from "../lib/export-serializers";
import { parseTurtleQuads, serializeTurtle } from "@wazoo/sparql-engine";

/**
 * RDF_IMPORT_CONTENT_TYPES are the serialized RDF formats import parses.
 * sparql-engine's parser reads the TriG grammar, a superset of Turtle,
 * N-Triples and N-Quads (the same parser the SDK uses), so one path covers
 * all of them. JSON-LD is not parsed anywhere in
 * the stack and is rejected rather than advertised.
 */
/** EXPORT_FORMATS are the content types export can serialize. */
const EXPORT_FORMATS = [
  "application/json",
  "text/plain",
  "application/n-quads",
  "application/n-triples",
  "text/turtle",
  "application/trig",
  "application/ld+json",
] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];

const TURTLE_FORMATS = {
  "application/n-quads": "n-quads",
  "application/n-triples": "n-triples",
  "text/turtle": "turtle",
} as const;
type TurtleExportFormat = keyof typeof TURTLE_FORMATS;

/** DEFAULT_EXPORT_LIMIT is the page size for formats that page by default. */
const DEFAULT_EXPORT_LIMIT = 1000;

export const RDF_IMPORT_CONTENT_TYPES = [
  "text/turtle",
  "application/trig",
  "application/n-triples",
  "application/n-quads",
  "text/n3",
] as const;

interface QuadRow {
  subject: string;
  predicate: string;
  object: string;
  graph?: string;
}

export function registerImportExportRoutes(
  app: OpenAPIHono<{ Bindings: Env }>,
) {
  app.openapi(
    createRoute({
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
    }),
    async (c) => {
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
        const items = JSON.parse(body.data) as QuadRow[];
        if (items.length > quadsCap) {
          return respond(
            c,
            {
              error: {
                code: "PAYLOAD_TOO_LARGE",
                message: `Import exceeds the ${quadsCap} quad limit per request`,
              },
            },
            413,
          );
        }
        await client.import({
          source: {
            kind: "serialized",
            contentType: "application/n-quads",
            data: items.map(quadToNQuad).join(""),
          },
        });

        return respond(c, { imported: { quads: items.length, chunks: 0 } });
      }

      if (
        contentType === "text/plain" ||
        contentType === "application/x-ndjson"
      ) {
        const lines = body.data
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0);

        if (lines.length > quadsCap) {
          return respond(
            c,
            {
              error: {
                code: "PAYLOAD_TOO_LARGE",
                message: `Import exceeds the ${quadsCap} chunk limit per request`,
              },
            },
            413,
          );
        }

        const chunks = lines.map((text, index) => {
          return {
            subject: `urn:wazoo:chunk:${index}`,
            predicate: "http://schema.org/text",
            object: text,
            graph: `urn:wazoo:import:${index}`,
          };
        });

        await client.import({
          source: {
            kind: "serialized",
            contentType: "application/n-quads",
            data: chunks.map(quadToNQuad).join(""),
          },
        });

        return respond(c, {
          imported: { quads: 0, chunks: chunks.length },
        });
      }

      const mediaType = contentType.split(";")[0].trim().toLowerCase();
      if ((RDF_IMPORT_CONTENT_TYPES as readonly string[]).includes(mediaType)) {
        let quads;
        try {
          quads = parseTurtleQuads(body.data);
        } catch (error) {
          return respond(
            c,
            {
              error: {
                code: "INVALID_ARGUMENT",
                message: `Could not parse ${mediaType}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            },
            400,
          );
        }
        if (quads.length > quadsCap) {
          return respond(
            c,
            {
              error: {
                code: "PAYLOAD_TOO_LARGE",
                message: `Import exceeds the ${quadsCap} quad limit per request`,
              },
            },
            413,
          );
        }
        await client.import({ source: { kind: "quads", quads } });
        return respond(c, { imported: { quads: quads.length, chunks: 0 } });
      }

      return respond(
        c,
        {
          error: {
            code: "UNSUPPORTED_CONTENT_TYPE",
            message: `Content type '${contentType}' is not supported. Use ${[
              ...RDF_IMPORT_CONTENT_TYPES,
              "application/json",
              "text/plain",
            ].join(", ")}.`,
          },
        },
        400,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/worlds/{worldId}/export",
      tags: ["ImportExport"],
      operationId: "exportWorld",
      summary: "Export graph data",
      description:
        "Export RDF quads from a world. Supports JSON (RDF/JSON array), Turtle, TriG, and JSON-LD output formats. Use the limit and offset query parameters for pagination.",
      "x-mint": { metadata: { title: "Export graph data" } },
      security: [{ bearerWorldsToken: [] }],
      request: {
        params: worldIdParam,
        query: exportQuery,
      },
      responses: {
        200: {
          description: "Export result",
          content: {
            "application/json": { schema: ExportQuadsResponseSchema },
            "text/plain": { schema: z.any() },
            "application/n-quads": { schema: z.any() },
            "application/n-triples": { schema: z.any() },
            "text/turtle": { schema: z.any() },
            "application/trig": { schema: z.any() },
            "application/ld+json": { schema: z.any() },
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
    },
  );
}

function quadToNQuad(quad: QuadRow) {
  const subject = namedNode(quad.subject);
  const predicate = namedNode(quad.predicate);
  const object = isNamedNodeValue(quad.object)
    ? namedNode(quad.object)
    : literal(quad.object);
  const graph = quad.graph ? ` ${namedNode(quad.graph)}` : "";
  return `${subject} ${predicate} ${object}${graph} .\n`;
}

function namedNode(value: string) {
  return `<${value.replace(/[<>]/g, "")}>`;
}

function literal(value: string) {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")}"`;
}

function isNamedNodeValue(value: string) {
  return /^https?:\/\//.test(value) || /^urn:/.test(value);
}
