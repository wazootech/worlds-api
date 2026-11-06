import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../../env";
import { execute, getDb, now, uid } from "../../lib/db";
import { createToken, sha256Hex } from "../../lib/crypto";
import { authorize } from "../../lib/auth";
import { respond } from "../../lib/respond";
import { createApiKeyRoute } from "./routes";

export function registerCreateApiKey(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(createApiKeyRoute, async (c) => {
    const env = c.env as unknown as Env;
    const auth = await authorize(c.req.raw, env);

    if (!auth.admin) {
      return respond(
        c,
        {
          error: {
            code: "FORBIDDEN",
            message: "Only admin keys can manage API keys",
          },
        },
        403,
      );
    }

    const body = c.req.valid("json");

    if (!body.namespace) {
      return respond(
        c,
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
        JSON.stringify(body.scopes ?? ["data:read", "data:write"]),
        ts,
      ],
    );

    return respond(
      c,
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
}
