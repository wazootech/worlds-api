import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../../env";
import { execute, getDb, now, queryOne } from "../../lib/db";
import { authorize, SCOPE_DATA_WRITE } from "../../lib/auth";
import { clearSdkCacheForWorld } from "../../lib/world-db";
import { getInferenceSetting } from "../../lib/inference";
import { respond } from "../../lib/respond";
import { deleteRoute, undeleteRoute } from "./routes-lifecycle";
import {
  GRACE_MS,
  requireWorldAccess,
  resolveWorldRow,
  statusFor,
  worldResource,
  type WorldRow,
} from "./shared";

export function registerDeleteWorld(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(deleteRoute, async (c) => {
    const env = c.env as unknown as Env;
    const worldId = c.req.param("worldId");
    const auth = await authorize(c.req.raw, env);
    const db = getDb(env);

    const row = await resolveWorldRow(db, worldId);
    if (!row) {
      return respond(
        c,
        { error: { code: "NOT_FOUND", message: "World not found" } },
        404,
      );
    }
    const worldAccess = requireWorldAccess(
      auth,
      row,
      worldId,
      SCOPE_DATA_WRITE,
    );
    if (worldAccess) return worldAccess;

    const ts = now();
    const expireTs = new Date(Date.now() + GRACE_MS).toISOString();

    await execute(
      db,
      "UPDATE worlds SET state = 'deleted', delete_time = ?, expire_time = ?, purge_status = 'pending', update_time = ? WHERE world_id = ?",
      [ts, expireTs, ts, worldId],
    );
    clearSdkCacheForWorld(worldId);
    return c.body(null, 204);
  });
}

export function registerUndeleteWorld(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(undeleteRoute, async (c) => {
    const env = c.env as unknown as Env;
    const worldId = c.req.param("worldId");
    const auth = await authorize(c.req.raw, env);
    const db = getDb(env);

    const row = await resolveWorldRow(db, worldId, true);
    if (!row) {
      return respond(
        c,
        { error: { code: "NOT_FOUND", message: "Deleted world not found" } },
        404,
      );
    }
    const worldAccess = requireWorldAccess(
      auth,
      row,
      worldId,
      SCOPE_DATA_WRITE,
    );
    if (worldAccess) return worldAccess;

    if (row.expire_time && row.expire_time < now()) {
      return respond(
        c,
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
      "UPDATE worlds SET state = 'active', delete_time = NULL, expire_time = NULL, purge_status = 'none', update_time = ? WHERE world_id = ?",
      [ts, worldId],
    );
    const restored = await queryOne<WorldRow>(
      db,
      "SELECT * FROM worlds WHERE world_id = ?",
      [worldId],
    );
    clearSdkCacheForWorld(worldId);
    return respond(
      c,
      worldResource(
        restored!,
        await statusFor(env, restored!),
        await getInferenceSetting(env, worldId),
      ),
    );
  });
}
