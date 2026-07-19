import { Hono } from "hono";
import type { Env } from "../env";
import { getDb, execute, query, uid, now } from "../lib/db";
import { sha256Hex, createToken } from "../lib/crypto";
import { authorize } from "../lib/auth";

const apiKeys = new Hono<{ Bindings: Env }>();

interface ApiKeyRow {
  uid: string;
  name: string;
  namespace: string;
  world_id: string | null;
  scopes: string;
  create_time: string;
  revoked_at: string | null;
}

apiKeys.post("/api-keys", async (c) => {
  const env = c.env as unknown as Env;
  const auth = await authorize(c.req.raw, env);

  if (!auth.admin) {
    return c.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Only admin keys can manage API keys",
        },
      },
      403,
    );
  }

  const body = await c.req.json<{
    namespace: string;
    worldId?: string;
    name?: string;
  }>();

  if (!body.namespace) {
    return c.json(
      {
        error: {
          code: "INVALID_ARGUMENT",
          message: "namespace is required",
        },
      },
      400,
    );
  }

  const db = getDb(env);
  const token = createToken("wzw");
  const hash = await sha256Hex(token);
  const keyUid = uid();
  const ts = now();

  await execute(
    db,
    "INSERT INTO api_keys (uid, key_hash, name, namespace, world_id, scopes, create_time) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      keyUid,
      hash,
      body.name ?? "",
      body.namespace,
      body.worldId ?? null,
      '["data:read","data:write"]',
      ts,
    ],
  );

  return c.json(
    {
      uid: keyUid,
      token,
      name: body.name ?? "",
      namespace: body.namespace,
      worldId: body.worldId ?? null,
      createTime: ts,
    },
    201,
  );
});

apiKeys.get("/api-keys", async (c) => {
  const env = c.env as unknown as Env;
  const auth = await authorize(c.req.raw, env);

  if (!auth.admin) {
    return c.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Only admin keys can list API keys",
        },
      },
      403,
    );
  }

  const namespace = c.req.query("namespace");
  const db = getDb(env);

  let sql =
    "SELECT uid, name, namespace, world_id, scopes, create_time FROM api_keys WHERE revoked_at IS NULL";
  const params: Array<string> = [];

  if (namespace) {
    sql += " AND namespace = ?";
    params.push(namespace);
  }

  sql += " ORDER BY create_time DESC";

  const rows = await query<ApiKeyRow>(db, sql, params);

  return c.json({
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

apiKeys.delete("/api-keys/:keyId", async (c) => {
  const env = c.env as unknown as Env;
  const auth = await authorize(c.req.raw, env);

  if (!auth.admin) {
    return c.json(
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
    return c.json(
      { error: { code: "NOT_FOUND", message: "API key not found" } },
      404,
    );
  }

  return c.body(null, 204);
});

export { apiKeys };
