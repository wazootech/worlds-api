import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../../env";
import { execute, getDb, now, queryOne } from "../../lib/db";
import { authorize, SCOPE_DATA_WRITE } from "../../lib/auth";
import { clearSdkCacheForWorld } from "../../lib/world-db";
import { getInferenceSetting, setInferenceSetting } from "../../lib/inference";
import {
  getCredentialForModel,
  setWorldState,
} from "../../lib/embeddings/store";
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
      // A model change is a state transition, not just a column write: it
      // needs a usable credential and leaves the world stale (design 4.1).
      const credential = await getCredentialForModel(
        env,
        row.namespace,
        body.embeddingModel!,
      );
      if (!credential || credential.status !== "active") {
        return respond(
          c,
          {
            error: {
              code: "EMBEDDING_CREDENTIAL_REQUIRED",
              message:
                "Set an active embedding credential for the namespace before choosing an embedding model",
            },
          },
          409,
        );
      }
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
