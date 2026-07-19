import { Hono } from "hono";
import type { Env } from "../env";
import { getDb, execute, query, uid, now } from "../lib/db";
import { authorize, requireAccess, unauthorized } from "../lib/auth";

const importExport = new Hono<{ Bindings: Env }>();

interface QuadRow {
  subject: string;
  predicate: string;
  object: string;
  graph: string;
}

interface ChunkRow {
  subject: string;
  text: string;
}

importExport.post("/worlds/:id/import", async (c) => {
  const env = c.env as unknown as Env;
  const worldId = c.req.param("id");
  const auth = await authorize(c.req.raw, env);
  const body = await c.req.json<{
    namespace?: string;
    data: string;
    contentType?: string;
  }>();
  const namespace = auth.admin
    ? (body.namespace ?? c.req.query("namespace"))
    : auth.namespace;
  if (!namespace) return unauthorized();

  const accessErr = requireAccess(auth, namespace, worldId);
  if (accessErr) return accessErr;
  const contentType = body.contentType ?? "text/turtle";

  if (!body.data) {
    return c.json(
      {
        error: {
          code: "INVALID_ARGUMENT",
          message: "data field is required",
        },
      },
      400,
    );
  }

  const db = getDb(env);

  if (contentType === "application/json") {
    const items = JSON.parse(body.data) as Array<{
      subject: string;
      predicate: string;
      object: string;
      graph?: string;
    }>;

    const stmts = items.map((item) => ({
      sql: "INSERT OR IGNORE INTO quads (id, namespace, world_id, subject, predicate, object, graph, create_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      args: [
        uid(),
        namespace,
        worldId,
        item.subject,
        item.predicate,
        item.object,
        item.graph ?? "default",
        now(),
      ],
    }));

    await db.batch(stmts, "write");

    return c.json({ imported: { quads: items.length, chunks: 0 } }, 200);
  }

  if (contentType === "text/plain" || contentType === "application/x-ndjson") {
    const lines = body.data
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const chunks = lines.map((line) => {
      let subject = "";
      let text = "";
      const jsonMatch = line.match(/^(\{.*\})$/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(line);
          subject = parsed.subject ?? "";
          text = parsed.text ?? parsed.content ?? parsed.value ?? line;
        } catch {
          text = line;
        }
      } else {
        const tabMatch = line.split("\t");
        if (tabMatch.length >= 2) {
          subject = tabMatch[0];
          text = tabMatch.slice(1).join("\t");
        } else {
          text = line;
        }
      }
      return {
        sql: "INSERT INTO chunks (id, namespace, world_id, subject, text, create_time) VALUES (?, ?, ?, ?, ?, ?)",
        args: [uid(), namespace, worldId, subject, text, now()],
      };
    });

    await db.batch(chunks, "write");

    return c.json({ imported: { quads: 0, chunks: chunks.length } }, 200);
  }

  return c.json(
    {
      error: {
        code: "UNSUPPORTED_CONTENT_TYPE",
        message: `Content type '${contentType}' is not supported. Use 'application/json' for quads or 'text/plain' for chunks.`,
      },
    },
    400,
  );
});

importExport.get("/worlds/:id/export", async (c) => {
  const env = c.env as unknown as Env;
  const worldId = c.req.param("id");
  const auth = await authorize(c.req.raw, env);
  const namespace = auth.admin ? c.req.query("namespace") : auth.namespace;
  if (!namespace) return unauthorized();

  const accessErr = requireAccess(auth, namespace, worldId);
  if (accessErr) return accessErr;

  const fmt = c.req.query("format") ?? "application/json";
  const limit = parseInt(c.req.query("limit") ?? "1000", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  const db = getDb(env);

  if (fmt === "application/json") {
    const quads = await query<QuadRow>(
      db,
      "SELECT subject, predicate, object, graph FROM quads WHERE namespace = ? AND world_id = ? LIMIT ? OFFSET ?",
      [namespace, worldId, limit, offset],
    );

    return c.json({
      quads: quads.map((q) => ({
        subject: q.subject,
        predicate: q.predicate,
        object: q.object,
        graph: q.graph,
      })),
      nextOffset: quads.length === limit ? offset + limit : undefined,
    });
  }

  if (fmt === "text/plain") {
    const chunks = await query<ChunkRow>(
      db,
      "SELECT subject, text FROM chunks WHERE namespace = ? AND world_id = ? LIMIT ? OFFSET ?",
      [namespace, worldId, limit, offset],
    );

    const lines = chunks.map((ch) =>
      ch.subject ? `${ch.subject}\t${ch.text}` : ch.text,
    );

    return c.text(lines.join("\n"));
  }

  return c.json(
    {
      error: {
        code: "UNSUPPORTED_FORMAT",
        message: `Export format '${fmt}' is not supported. Use 'application/json' or 'text/plain'.`,
      },
    },
    400,
  );
});

export { importExport };
