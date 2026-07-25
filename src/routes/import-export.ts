import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { createLibsqlClient } from "@worlds/libsql";
import type { Env } from "../env";
import { authorize, requireAccess, unauthorized } from "../lib/auth";
import { resolveWorldDatabase, worldDb } from "../lib/world-db";
import { respond } from "../lib/respond";
import {
  ImportRequestSchema,
  ImportResponseSchema,
  ExportQuadsResponseSchema,
  worldIdParam,
  exportQuery,
} from "../lib/schemas";

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
      const worldId = c.req.param("id");
      const auth = await authorize(c.req.raw, env);
      const body = c.req.valid("json");
      const namespace = auth.admin
        ? (body.namespace ?? c.req.query("namespace"))
        : auth.namespace;
      if (!namespace) return unauthorized();

      const accessErr = requireAccess(auth, namespace, worldId);
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
      const client = await createLibsqlClient({ client: db });

      if (contentType === "application/json") {
        const items = JSON.parse(body.data) as QuadRow[];
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

        const chunks = lines.map((text, index) => {
          return {
            subject: `urn:wazoo:chunk:${index}`,
            predicate: "http://www.w3.org/2000/01/rdf-schema#comment",
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
      const query = c.req.valid("query");
      const namespace = auth.admin ? query.namespace : auth.namespace;
      if (!namespace) return unauthorized();

      const accessErr = requireAccess(auth, namespace, worldId);
      if (accessErr) return accessErr;

      const fmt = query.format ?? "application/json";
      const limit = parseInt(query.limit ?? "1000", 10);
      const offset = parseInt(query.offset ?? "0", 10);

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

      return respond(
        c,
        {
          error: {
            code: "UNSUPPORTED_FORMAT",
            message: `Export format '${fmt}' is not supported. Use 'application/json' or 'text/plain'.`,
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
