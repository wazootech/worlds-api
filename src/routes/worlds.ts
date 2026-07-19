import { Hono, type Context } from "hono";
import type { Env } from "../env";
import { getDb, query, queryOne, execute, uid, now } from "../lib/db";
import { authorize, requireAccess, unauthorized } from "../lib/auth";

const worlds = new Hono<{ Bindings: Env }>();

interface WorldRow {
  uid: string;
  namespace: string;
  world_id: string;
  display_name: string;
  state: string;
  delete_time: string | null;
  expire_time: string | null;
  create_time: string;
  update_time: string;
}

function worldResource(row: WorldRow) {
  return {
    name: `namespaces/${row.namespace}/worlds/${row.world_id}`,
    uid: row.uid,
    namespace: row.namespace,
    worldId: row.world_id,
    displayName: row.display_name,
    state: row.state,
    createTime: row.create_time,
    updateTime: row.update_time,
    deleteTime: row.delete_time ?? undefined,
    expireTime: row.expire_time ?? undefined,
  };
}

function namespaceFor(
  auth: Awaited<ReturnType<typeof authorize>>,
  explicit?: string | null,
) {
  if (auth.admin) return explicit ?? null;
  return auth.namespace ?? null;
}

worlds.get("/worlds", async (c) => {
  const env = c.env as unknown as Env;
  const auth = await authorize(c.req.raw, env);
  const namespace = namespaceFor(auth, c.req.query("namespace"));
  if (!namespace) return unauthorized();

  const accessErr = requireAccess(auth, namespace);
  if (accessErr) return accessErr;

  const db = getDb(env);
  const rows = await query<WorldRow>(
    db,
    "SELECT * FROM worlds_metadata WHERE namespace = ? AND state != 'deleted' ORDER BY create_time DESC",
    [namespace],
  );

  return c.json({ worlds: rows.map(worldResource) });
});

worlds.post("/worlds", async (c) => {
  const env = c.env as unknown as Env;
  const auth = await authorize(c.req.raw, env);
  const body = await c.req.json<{
    namespace?: string;
    worldId: string;
    displayName?: string;
  }>();
  const namespace = namespaceFor(auth, body.namespace);
  if (!namespace) return unauthorized();

  const accessErr = requireAccess(auth, namespace);
  if (accessErr) return accessErr;

  if (!body.worldId) {
    return c.json(
      { error: { code: "INVALID_ARGUMENT", message: "worldId is required" } },
      400,
    );
  }

  const db = getDb(env);
  const worldUid = `w_${uid()}`;
  const ts = now();
  const displayName = body.displayName ?? body.worldId;

  try {
    await execute(
      db,
      "INSERT INTO worlds_metadata (uid, namespace, world_id, display_name, state, create_time, update_time) VALUES (?, ?, ?, ?, 'active', ?, ?)",
      [worldUid, namespace, body.worldId, displayName, ts, ts],
    );

    return c.json(
      worldResource({
        uid: worldUid,
        namespace,
        world_id: body.worldId,
        display_name: displayName,
        state: "active",
        delete_time: null,
        expire_time: null,
        create_time: ts,
        update_time: ts,
      }),
      201,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("UNIQUE constraint")) {
      return c.json(
        {
          error: {
            code: "ALREADY_EXISTS",
            message: `World '${body.worldId}' already exists in namespace '${namespace}'`,
          },
        },
        409,
      );
    }
    throw err;
  }
});

worlds.get("/worlds/:id", async (c) => {
  const env = c.env as unknown as Env;
  const worldId = c.req.param("id");
  const auth = await authorize(c.req.raw, env);
  const namespace = namespaceFor(auth, c.req.query("namespace"));
  if (!namespace) return unauthorized();

  const accessErr = requireAccess(auth, namespace, worldId);
  if (accessErr) return accessErr;

  const db = getDb(env);
  const row = await queryOne<WorldRow>(
    db,
    "SELECT * FROM worlds_metadata WHERE namespace = ? AND world_id = ? AND state != 'deleted'",
    [namespace, worldId],
  );

  if (!row) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "World not found" } },
      404,
    );
  }

  return c.json(worldResource(row));
});

worlds.patch("/worlds/:id", async (c) => {
  const env = c.env as unknown as Env;
  const worldId = c.req.param("id");
  const auth = await authorize(c.req.raw, env);
  const body = await c.req.json<{ namespace?: string; displayName?: string }>();
  const namespace = namespaceFor(
    auth,
    body.namespace ?? c.req.query("namespace"),
  );
  if (!namespace) return unauthorized();

  if (!auth.admin && auth.namespace !== namespace) {
    return unauthorized();
  }

  if (!body.displayName) {
    return c.json(
      {
        error: {
          code: "INVALID_ARGUMENT",
          message: "displayName is required",
        },
      },
      400,
    );
  }

  const db = getDb(env);
  const ts = now();

  const result = await execute(
    db,
    "UPDATE worlds_metadata SET display_name = ?, update_time = ? WHERE namespace = ? AND world_id = ? AND state != 'deleted'",
    [body.displayName, ts, namespace, worldId],
  );

  if (result.rowsAffected === 0) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "World not found" } },
      404,
    );
  }

  const row = await queryOne<WorldRow>(
    db,
    "SELECT * FROM worlds_metadata WHERE namespace = ? AND world_id = ?",
    [namespace, worldId],
  );

  return c.json(worldResource(row!));
});

worlds.delete("/worlds/:id", async (c) => {
  const env = c.env as unknown as Env;
  const worldId = c.req.param("id");
  const auth = await authorize(c.req.raw, env);
  const namespace = namespaceFor(auth, c.req.query("namespace"));
  if (!namespace) return unauthorized();

  if (!auth.admin && auth.namespace !== namespace) {
    return unauthorized();
  }

  const db = getDb(env);
  const ts = now();
  const expireTs = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const result = await execute(
    db,
    "UPDATE worlds_metadata SET state = 'deleted', delete_time = ?, expire_time = ? WHERE namespace = ? AND world_id = ? AND state != 'deleted'",
    [ts, expireTs, namespace, worldId],
  );

  if (result.rowsAffected === 0) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "World not found" } },
      404,
    );
  }

  return c.body(null, 204);
});

worlds.post("/worlds/:id/undelete", async (c) => {
  const env = c.env as unknown as Env;
  const worldId = c.req.param("id");
  const auth = await authorize(c.req.raw, env);
  let explicit: string | undefined;
  if (auth.admin) {
    const body = await c.req
      .json<{ namespace?: string }>()
      .catch(() => ({ namespace: undefined }));
    explicit = body.namespace;
  }
  const namespace = namespaceFor(auth, explicit ?? c.req.query("namespace"));
  if (!namespace) return unauthorized();

  if (!auth.admin && auth.namespace !== namespace) {
    return unauthorized();
  }

  const db = getDb(env);

  const row = await queryOne<WorldRow>(
    db,
    "SELECT * FROM worlds_metadata WHERE namespace = ? AND world_id = ? AND state = 'deleted'",
    [namespace, worldId],
  );

  if (!row) {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Deleted world not found",
        },
      },
      404,
    );
  }

  if (row.expire_time && row.expire_time < now()) {
    return c.json(
      {
        error: {
          code: "WORLD_RESTORE_BLOCKED",
          message: "World has expired and cannot be restored",
        },
      },
      409,
    );
  }

  const ts = now();

  await execute(
    db,
    "UPDATE worlds_metadata SET state = 'active', delete_time = NULL, expire_time = NULL, update_time = ? WHERE uid = ?",
    [ts, row.uid],
  );

  const restored = await queryOne<WorldRow>(
    db,
    "SELECT * FROM worlds_metadata WHERE uid = ?",
    [row.uid],
  );

  return c.json(worldResource(restored!));
});

export { worlds };
