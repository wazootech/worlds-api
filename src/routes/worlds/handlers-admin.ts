import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../../env";
import { execute, getDb, now } from "../../lib/db";
import { authorize } from "../../lib/auth";
import { clearSdkCache } from "../../lib/world-db";
import { runPurgeSweep } from "../../lib/purge";
import { revokeNamespaceCredentials } from "../../lib/embeddings/store";
import { respond } from "../../lib/respond";
import { namespaceDeleteRoute, purgeRoute } from "./routes-admin";
import { GRACE_MS } from "./shared";
import { cleanupNamespaceVectors } from "./vector-cleanup";

export function registerNamespaceDelete(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(namespaceDeleteRoute, async (c) => {
    const env = c.env as unknown as Env;
    const auth = await authorize(c.req.raw, env);
    if (!auth.admin) {
      return respond(
        c,
        { error: { code: "FORBIDDEN", message: "Admin key required" } },
        403,
      );
    }

    const namespace = c.req.param("namespace");
    const db = getDb(env);
    const ts = now();
    const expireTs = new Date(Date.now() + GRACE_MS).toISOString();

    // Mark every non-purged world for the namespace deleted, reusing the same
    // 30-day grace window and purge sweep as per-world deletion.
    const worldResult = await execute(
      db,
      "UPDATE worlds SET state = 'deleted', delete_time = ?, expire_time = ?, purge_status = 'pending', update_time = ? WHERE namespace = ? AND state != 'deleted' AND purge_status != 'purged'",
      [ts, expireTs, ts, namespace],
    );

    // Revoke every data-plane key for the namespace so credentials stop
    // working immediately even before the grace period elapses.
    const keyResult = await execute(
      db,
      "UPDATE api_keys SET revoked_at = ? WHERE namespace = ? AND revoked_at IS NULL",
      [ts, namespace],
    );

    // The namespace's vectors go with it (design section 7, deletion): their
    // Vectorize metadata carries chunk text. Done before the credential is
    // revoked and gated on the Vectorize binding, not on an embedder. The
    // D1 chunk rows are what identify the ids, so a failed or partial run
    // is reported (never silent), leaves those rows, and is retried by
    // calling this endpoint again or by the purge sweep.
    const vectorCleanup = await cleanupNamespaceVectors(env, namespace);

    // The namespace's embedding credential dies with the namespace; its
    // worlds are marked stale so a restore cannot make removed vectors live.
    await revokeNamespaceCredentials(env, namespace);

    // Invalidate all cached SDKs since multiple worlds may have been affected.
    clearSdkCache();

    return respond(c, {
      deletedWorlds: worldResult.rowsAffected,
      revokedKeys: keyResult.rowsAffected,
      ...(vectorCleanup && { vectorCleanup }),
    });
  });
}

export function registerPurge(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(purgeRoute, async (c) => {
    const env = c.env as unknown as Env;
    const auth = await authorize(c.req.raw, env);
    if (!auth.admin) {
      return respond(
        c,
        { error: { code: "FORBIDDEN", message: "Admin key required" } },
        403,
      );
    }
    const result = await runPurgeSweep(env);
    return respond(c, result);
  });
}
