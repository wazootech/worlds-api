import { Hono } from "hono";
import type { Env } from "../env";
import { getDb, query } from "../lib/db";
import { authorize, requireAccess, unauthorized } from "../lib/auth";

const search = new Hono<{ Bindings: Env }>();

interface FtsRow {
  subject: string;
  text: string;
  rank: number;
}

interface QuadSearchRow {
  subject: string;
  predicate: string;
  object: string;
}

search.post("/worlds/:id/search", async (c) => {
  const env = c.env as unknown as Env;
  const worldId = c.req.param("id");
  const auth = await authorize(c.req.raw, env);
  const body = await c.req.json<{
    namespace?: string;
    query: string;
    limit?: number;
  }>();
  const namespace = auth.admin
    ? (body.namespace ?? c.req.query("namespace"))
    : auth.namespace;
  if (!namespace) return unauthorized();

  const accessErr = requireAccess(auth, namespace, worldId);
  if (accessErr) return accessErr;

  if (!body.query) {
    return c.json(
      {
        error: {
          code: "INVALID_ARGUMENT",
          message: "query is required",
        },
      },
      400,
    );
  }

  const limit = body.limit ?? 20;
  const db = getDb(env);

  const ftsQuery = body.query
    .split(/\s+/)
    .map((w) => `"${w}"`)
    .join(" OR ");

  try {
    const rows = await query<FtsRow>(
      db,
      `SELECT c.subject, c.text, rank
       FROM chunks_fts f
       JOIN chunks c ON f.rowid = c.rowid
       WHERE chunks_fts MATCH ? AND c.namespace = ? AND c.world_id = ?
       ORDER BY rank
       LIMIT ?`,
      [ftsQuery, namespace, worldId, limit],
    );

    return c.json({
      results: rows.map((r) => ({
        subject: r.subject,
        content: r.text,
        score: r.rank,
      })),
    });
  } catch {
    const likePattern = `%${body.query}%`;

    const quadRows = await query<QuadSearchRow>(
      db,
      "SELECT subject, predicate, object FROM quads WHERE namespace = ? AND world_id = ? AND (subject LIKE ? OR predicate LIKE ? OR object LIKE ?) LIMIT ?",
      [namespace, worldId, likePattern, likePattern, likePattern, limit],
    );

    return c.json({
      results: quadRows.map((r) => ({
        subject: r.subject,
        predicate: r.predicate,
        object: r.object,
      })),
      mode: "fallback",
    });
  }
});

export { search };
