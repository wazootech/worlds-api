import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../../env";
import { authorize } from "../../lib/auth";
import { respond } from "../../lib/respond";
import {
  getCredential,
  listCredentials,
  revokeCredential,
  setCredential,
} from "../../lib/embeddings/store";
import { clearSdkCache } from "../../lib/world-db";
import { deleteRouteDef, getRouteDef, listRouteDef, putRoute } from "./routes";
import { API_KEY_PATTERN, credentialResource, guard, notFound } from "./shared";

export function registerEmbeddingHandlers(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(listRouteDef, async (c) => {
    const env = c.env as unknown as Env;
    const namespace = c.req.param("namespace");
    const auth = await authorize(c.req.raw, env);
    const denied = guard(auth, namespace);
    if (denied) return denied;

    const rows = await listCredentials(env, namespace);
    return respond(c, { providers: rows.map(credentialResource) });
  });

  app.openapi(putRoute, async (c) => {
    const env = c.env as unknown as Env;
    const { namespace, provider } = c.req.valid("param");
    const auth = await authorize(c.req.raw, env);
    const denied = guard(auth, namespace);
    if (denied) return denied;

    const body = c.req.valid("json");
    if (!API_KEY_PATTERN.test(body.apiKey)) {
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message:
              "apiKey must be 16-512 printable characters with no whitespace",
          },
        },
        400,
      );
    }

    const result = await setCredential(env, namespace, provider, body.apiKey);
    if (!result.ok) {
      return respond(
        c,
        {
          error: {
            code: "EMBEDDINGS_NOT_CONFIGURED",
            message: "Embedding credentials are not enabled on this deployment",
          },
        },
        503,
      );
    }
    // Cached SDKs may hold an embedder resolved against the old credential.
    clearSdkCache();
    return respond(c, credentialResource(result.row));
  });

  app.openapi(getRouteDef, async (c) => {
    const env = c.env as unknown as Env;
    const { namespace, provider } = c.req.valid("param");
    const auth = await authorize(c.req.raw, env);
    const denied = guard(auth, namespace);
    if (denied) return denied;

    const row = await getCredential(env, namespace, provider);
    if (!row) return respond(c, notFound, 404);
    return respond(c, credentialResource(row));
  });

  app.openapi(deleteRouteDef, async (c) => {
    const env = c.env as unknown as Env;
    const { namespace, provider } = c.req.valid("param");
    const auth = await authorize(c.req.raw, env);
    const denied = guard(auth, namespace);
    if (denied) return denied;

    const row = await getCredential(env, namespace, provider);
    if (!row) return respond(c, notFound, 404);
    await revokeCredential(env, namespace, provider);
    clearSdkCache();
    return c.body(null, 204);
  });
}
