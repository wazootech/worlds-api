import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../../env";
import { execute, getDb, now, queryOne } from "../../lib/db";
import { authorize, SCOPE_DATA_WRITE } from "../../lib/auth";
import {
  MAX_PAUSE_SECONDS,
  MIN_PAUSE_SECONDS,
  setPauseUntil,
} from "../../lib/pause";
import { clearSdkCacheForWorld } from "../../lib/world-db";
import { getInferenceSetting } from "../../lib/inference";
import { respond } from "../../lib/respond";
import { pauseRoute } from "./routes-suspend";
import {
  requireWorldAccess,
  resolveWorldRow,
  statusFor,
  worldResource,
  type WorldRow,
} from "./shared";

/**
 * Self-service pause (wazoo-api#22): a namespace key with data:write may pause
 * its own world with a mandatory time limit; the world auto-resumes when the
 * limit ends. Each write is awaited and confirmed by a re-read before the
 * response reports success.
 */
export function registerPauseWorld(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(pauseRoute, async (c) => {
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

    const { durationSeconds } = c.req.valid("json") as {
      durationSeconds: number;
    };
    if (
      !Number.isInteger(durationSeconds) ||
      durationSeconds < MIN_PAUSE_SECONDS ||
      durationSeconds > MAX_PAUSE_SECONDS
    ) {
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: `durationSeconds must be an integer between ${MIN_PAUSE_SECONDS} and ${MAX_PAUSE_SECONDS}`,
          },
        },
        400,
      );
    }
    if (row.state === "deleted") {
      return respond(
        c,
        {
          error: {
            code: "FAILED_PRECONDITION",
            message: "World is deleted",
          },
        },
        400,
      );
    }

    const pauseUntil = new Date(
      Date.parse(now()) + durationSeconds * 1000,
    ).toISOString();
    await execute(
      db,
      "UPDATE worlds SET state = 'paused', update_time = ? WHERE world_id = ?",
      [now(), worldId],
    );
    await setPauseUntil(env, worldId, pauseUntil);
    const paused = await queryOne<WorldRow>(
      db,
      "SELECT * FROM worlds WHERE world_id = ?",
      [worldId],
    );
    clearSdkCacheForWorld(worldId);
    return respond(
      c,
      worldResource(
        paused!,
        await statusFor(env, paused!),
        await getInferenceSetting(env, worldId),
        pauseUntil,
      ),
    );
  });
}
