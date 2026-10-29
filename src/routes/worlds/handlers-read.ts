import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../../env";
import { getDb, query } from "../../lib/db";
import {
  authorize,
  forbiddenScope,
  hasScope,
  SCOPE_DATA_READ,
  unauthorized,
} from "../../lib/auth";
import {
  getInferenceSetting,
  loadInferenceSettings,
} from "../../lib/inference";
import { loadEmbeddingStatuses } from "../../lib/embeddings/store";
import { respond } from "../../lib/respond";
import { getRoute, listRoute } from "./routes-read";
import {
  requireWorldAccess,
  resolveWorldRow,
  statusFor,
  worldResource,
  type WorldRow,
} from "./shared";

export function registerListWorlds(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(listRoute, async (c) => {
    const env = c.env as unknown as Env;
    const auth = await authorize(c.req.raw, env);
    const db = getDb(env);

    if (!auth.admin && !auth.namespace) return unauthorized();
    if (!hasScope(auth, SCOPE_DATA_READ)) {
      return forbiddenScope(SCOPE_DATA_READ);
    }

    const rows = await query<WorldRow>(
      db,
      auth.admin
        ? "SELECT * FROM worlds WHERE state != 'deleted' ORDER BY create_time DESC"
        : "SELECT * FROM worlds WHERE namespace = ? AND state != 'deleted' ORDER BY create_time DESC",
      auth.admin ? [] : [auth.namespace!],
    );
    const statuses = await loadEmbeddingStatuses(env, rows ?? []);
    const inference = await loadInferenceSettings(
      env,
      auth.admin ? undefined : auth.namespace!,
    );
    return respond(c, {
      worlds: (rows ?? []).map((row) =>
        worldResource(
          row,
          statuses.get(row.world_id) ?? "unconfigured",
          inference.get(row.world_id),
        ),
      ),
    });
  });
}

export function registerGetWorld(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(getRoute, async (c) => {
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
    const worldAccess = requireWorldAccess(auth, row, worldId, SCOPE_DATA_READ);
    if (worldAccess) return worldAccess;

    return respond(
      c,
      worldResource(
        row,
        await statusFor(env, row),
        await getInferenceSetting(env, worldId),
      ),
    );
  });
}
