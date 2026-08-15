import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { createLibsqlClient } from "@worlds/libsql";
import type { Env } from "../env";
import { authorize, requireAccess, unauthorized } from "../lib/auth";
import { SCOPE_DATA_READ, SCOPE_DATA_WRITE } from "../lib/auth";
import { maxImportBytes, maxImportQuads } from "../lib/abuse";
import { resolveWorldDatabase, worldDb } from "../lib/world-db";
import { respond } from "../lib/respond";
import {
  ImportRequestSchema,
  ImportResponseSchema,
  ExportQuadsResponseSchema,
  worldIdParam,
  exportQuery,
} from "../lib/schemas";
import {
  serializeQuadsToJsonLd,
  serializeQuadsToTrig,
} from "../lib/export-serializers";

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
      path: "/worlds/{id}/import",
      tags: ["ImportExport"],
      operationId: "importWorld",
      summary: "Import graph data",
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
      },
    }),
    async (c) => {
      const env = c.env as unknown as Env;
      const worldUid = c.req.param("id");
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

      const db = worldDb(ref);
      const client = await createLibsqlClient({ client: db });

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

      return respond(
        c,
        {
          error: {
            code: "UNSUPPORTED_CONTENT_TYPE",
            message: `Content type '${contentType}' is not supported. Use 'application/json' for quads or 'text/plain' for chunks.`,
          },
        },
        400,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/worlds/{id}/export",
      tags: ["ImportExport"],
      operationId: "exportWorld",
      summary: "Export graph data",
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
      const worldUid = c.req.param("id");
      const auth = await authorize(c.req.raw, env);
      const query = c.req.valid("query");

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

      const fmt = query.format ?? "application/json";
      const limit = parseInt(query.limit ?? "1000", 10);
      const offset = parseInt(query.offset ?? "0", 10);

      const db = worldDb(ref);
      const client = await createLibsqlClient({ client: db });

      if (fmt === "application/json") {
        const exported = await client.export({
          format: { kind: "quads" },
        });
        const quads = exported.kind === "quads" ? exported.quads : [];

        return respond(c, {
          quads: quads.slice(offset, offset + limit).map((q) => ({
            subject: q.subject.value,
            predicate: q.predicate.value,
            object: q.object.value,
            graph:
              q.graph.termType === "DefaultGraph" ? undefined : q.graph.value,
          })),
          nextOffset:
            quads.length > offset + limit ? offset + limit : undefined,
        });
      }

      if (fmt === "text/plain") {
        const exported = await client.export({
          format: { kind: "quads" },
        });
        const quads = exported.kind === "quads" ? exported.quads : [];

        const lines = quads
          .filter((q) => q.predicate.value === "http://schema.org/text")
          .slice(offset, offset + limit)
          .map((q) => `${q.subject.value}\t${q.object.value}`);

        return c.text(lines.join("\n"));
      }

      if (
        fmt === "application/n-quads" ||
        fmt === "application/n-triples" ||
        fmt === "text/turtle"
      ) {
        const exported = await client.export({
          format: { kind: "serialized", contentType: fmt },
        });

        return c.text(
          exported.kind === "serialized" ? exported.data : "",
          200,
          {
            "Content-Type": fmt,
          },
        );
      }

      if (fmt === "application/trig" || fmt === "application/ld+json") {
        const exported = await client.export({
          format: { kind: "quads" },
        });
        const quads = exported.kind === "quads" ? exported.quads : [];
        const data =
          fmt === "application/trig"
            ? await serializeQuadsToTrig(quads)
            : serializeQuadsToJsonLd(quads);

        return c.text(data, 200, {
          "Content-Type": fmt,
        });
      }

      return respond(
        c,
        {
          error: {
            code: "UNSUPPORTED_FORMAT",
            message: `Export format '${fmt}' is not supported. Use 'application/json', 'text/plain', 'application/n-quads', 'application/n-triples', 'text/turtle', 'application/trig', or 'application/ld+json'.`,
          },
        },
        400,
      );
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
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function isNamedNodeValue(value: string) {
  return /^https?:\/\//.test(value) || /^urn:/.test(value);
}
