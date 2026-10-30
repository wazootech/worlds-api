import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../../env";
import { execute, getDb, now, query } from "../../lib/db";
import { authorize } from "../../lib/auth";
import { respond } from "../../lib/respond";
import { deleteApiKeyRoute, listApiKeysRoute } from "./routes";

interface ApiKeyRow {
  uid: string;
  name: string;
  namespace: string;
  world_id: string | null;
  scopes: string;
  create_time: string;
  revoked_at: string | null;
}

export function registerListApiKeys(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(listApiKeysRoute, async (c) => {
    const env = c.env as unknown as Env;
    const auth = await authorize(c.req.raw, env);

    if (!auth.admin) {
      return respond(
        c,
        {
          error: {
            code: "FORBIDDEN",
            message: "Only admin keys can list API keys",
          },
        },
        403,
      );
    }

    const query_ = c.req.valid("query");
    const db = getDb(env);

    let sql =
      "SELECT uid, name, namespace, world_id, scopes, create_time FROM api_keys WHERE revoked_at IS NULL";
    const params: Array<string> = [];

    if (query_.namespace) {
      sql += " AND namespace = ?";
      params.push(query_.namespace);
    }

    sql += " ORDER BY create_time DESC";

    const rows = await query<ApiKeyRow>(db, sql, params);

    return respond(c, {
      keys: rows.map((r) => ({
        uid: r.uid,
        name: r.name,
        namespace: r.namespace,
        worldId: r.world_id ?? undefined,
        scopes: JSON.parse(r.scopes),
        createTime: r.create_time,
      })),
    });
  });
}

export function registerDeleteApiKey(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(deleteApiKeyRoute, async (c) => {
    const env = c.env as unknown as Env;
    const auth = await authorize(c.req.raw, env);

    if (!auth.admin) {
      return respond(
        c,
        {
          error: {
            code: "FORBIDDEN",
            message: "Only admin keys can revoke API keys",
          },
        },
        403,
      );
    }

    const keyId = c.req.param("keyId");
    const db = getDb(env);
    const ts = now();

    const result = await execute(
      db,
      "UPDATE api_keys SET revoked_at = ? WHERE uid = ? AND revoked_at IS NULL",
      [ts, keyId],
    );

    if (result.rowsAffected === 0) {
      return respond(
        c,
        { error: { code: "NOT_FOUND", message: "API key not found" } },
        404,
      );
    }

    return c.body(null, 204);
  });
}
