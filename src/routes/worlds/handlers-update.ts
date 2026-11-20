import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../../env";
import { execute, getDb, now, queryOne } from "../../lib/db";
import { authorize, SCOPE_DATA_WRITE } from "../../lib/auth";
import { clearPause } from "../../lib/pause";
import { clearSdkCacheForWorld } from "../../lib/world-db";
import { getInferenceSetting, setInferenceSetting } from "../../lib/inference";
import { setWorldState } from "../../lib/embeddings/store";
import {
  guardStateTransition,
  requireCredentialForModelChange,
} from "./update-guards";
import { respond } from "../../lib/respond";
import { updateRoute } from "./routes-write";
import {
  requireWorldAccess,
  resolveWorldRow,
  statusFor,
  worldResource,
  type WorldRow,
} from "./shared";

export function registerUpdateWorld(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(updateRoute, async (c) => {
    const env = c.env as unknown as Env;
    const worldId = c.req.param("worldId");
    const auth = await authorize(c.req.raw, env);
    const body = c.req.valid("json");
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

    const stateGuard = guardStateTransition(auth, row, body);
    if (stateGuard) return stateGuard;

    const setClauses: string[] = [];
    const setArgs: (string | number)[] = [];

    if (body.displayName) {
      setClauses.push("display_name = ?");
      setArgs.push(body.displayName);
    }
    const modelChanged =
      body.embeddingModel !== undefined &&
      body.embeddingModel !== row.embedding_model;
    if (modelChanged) {
      const guard = await requireCredentialForModelChange(
        c,
        env,
        row.namespace,
        body.embeddingModel!,
      );
      if (guard) return guard;
      setClauses.push("embedding_model = ?");
      setArgs.push(body.embeddingModel!);
    }
    if (body.chunkSize !== undefined) {
      setClauses.push("chunk_size = ?");
      setArgs.push(body.chunkSize);
    }
    if (body.topK !== undefined) {
      setClauses.push("top_k = ?");
      setArgs.push(body.topK);
    }
    if (body.minScore !== undefined) {
      setClauses.push("min_score = ?");
      setArgs.push(body.minScore);
    }
    if (body.state !== undefined) {
      setClauses.push("state = ?");
      setArgs.push(body.state);
    }

    if (setClauses.length === 0 && body.inference === undefined) {
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "At least one field to update is required",
          },
        },
        400,
      );
    }

    setClauses.push("update_time = ?");
    setArgs.push(now(), worldId);

    await execute(
      db,
      `UPDATE worlds SET ${setClauses.join(", ")} WHERE world_id = ?`,
      setArgs,
    );
    if (body.inference !== undefined) {
      await setInferenceSetting(env, worldId, body.inference);
    }
    if (body.state !== undefined) {
      // Leaving 'paused' retires the pause deadline; a resumed paused world
      // must not re-pause on a stale deadline.
      await clearPause(env, worldId);
    }

    if (modelChanged) {
      // Search stays keyword-only until an explicit reindex rebuilds vectors
      // with the new model.
      await setWorldState(env, worldId, "stale", body.embeddingModel!);
    }

    const updated = await queryOne<WorldRow>(
      db,
      "SELECT * FROM worlds WHERE world_id = ?",
      [worldId],
    );
    clearSdkCacheForWorld(worldId);
    return respond(
      c,
      worldResource(
        updated!,
        await statusFor(env, updated!),
        await getInferenceSetting(env, worldId),
      ),
    );
  });
}
