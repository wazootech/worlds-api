import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../../env";
import { execute, getDb, now, queryOne } from "../../lib/db";
import { authorize, SCOPE_DATA_WRITE } from "../../lib/auth";
import { clearSdkCacheForWorld } from "../../lib/world-db";
import { getInferenceSetting } from "../../lib/inference";
import { respond } from "../../lib/respond";
import { resumeRoute, suspendRoute } from "./routes-suspend";
import {
  requireWorldAccess,
  resolveWorldRow,
  statusFor,
  worldResource,
  type WorldRow,
} from "./shared";

export function registerSuspendWorld(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(suspendRoute, async (c) => {
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

    await execute(
      db,
      "UPDATE worlds SET state = 'suspended', update_time = ? WHERE world_id = ?",
      [now(), worldId],
    );
    const suspended = await queryOne<WorldRow>(
      db,
      "SELECT * FROM worlds WHERE world_id = ?",
      [worldId],
    );
    clearSdkCacheForWorld(worldId);
    return respond(
      c,
      worldResource(
        suspended!,
        await statusFor(env, suspended!),
        await getInferenceSetting(env, worldId),
      ),
    );
  });
}

export function registerResumeWorld(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(resumeRoute, async (c) => {
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

    await execute(
      db,
      "UPDATE worlds SET state = 'active', update_time = ? WHERE world_id = ?",
      [now(), worldId],
    );
    const resumed = await queryOne<WorldRow>(
      db,
      "SELECT * FROM worlds WHERE world_id = ?",
      [worldId],
    );
    clearSdkCacheForWorld(worldId);
    return respond(
      c,
      worldResource(
        resumed!,
        await statusFor(env, resumed!),
        await getInferenceSetting(env, worldId),
      ),
    );
  });
}
