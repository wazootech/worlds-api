import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../env";
import { getDb, query, queryOne, execute, uid, now } from "../lib/db";
import {
  authorize,
  requireAccess,
  unauthorized,
  forbidden,
  forbiddenScope,
  hasScope,
  SCOPE_DATA_READ,
  SCOPE_DATA_WRITE,
} from "../lib/auth";
import { initializeWorldDatabase } from "../lib/world-db";
import {
  provisionWorldDatabase,
  destroyWorldDatabase,
  DatabaseLimitError,
} from "../lib/turso";
import { runPurgeSweep } from "../lib/purge";
import { respond } from "../lib/respond";
import {
  WorldResourceSchema,
  CreateWorldRequestSchema,
  UpdateWorldRequestSchema,
  worldIdParam,
  worldsListQuery,
} from "../lib/schemas";

const GRACE_MS = 30 * 24 * 60 * 60 * 1000;

interface WorldRow {
  uid: string;
  namespace: string;
  display_name: string;
  state: string;
  database_url: string | null;
  database_auth_token: string | null;
  embedding_model: string;
  chunk_size: number;
  top_k: number;
  min_score: number;
  delete_time: string | null;
  expire_time: string | null;
  create_time: string;
  update_time: string;
}

function worldResource(row: WorldRow) {
  return {
    name: `worlds/${row.uid}`,
    uid: row.uid,
    displayName: row.display_name,
    state: row.state,
    storage: row.database_url ? "libsql-per-world" : "legacy-shared-libsql",
    embeddingModel: row.embedding_model,
    chunkSize: row.chunk_size,
    topK: row.top_k,
    minScore: row.min_score,
    createTime: row.create_time,
    updateTime: row.update_time,
    deleteTime: row.delete_time ?? undefined,
    expireTime: row.expire_time ?? undefined,
  };
}

async function resolveWorld(
  db: ReturnType<typeof getDb>,
  worldUid: string,
  deleted = false,
): Promise<WorldRow | null> {
  return queryOne<WorldRow>(
    db,
    deleted
      ? "SELECT * FROM worlds_metadata WHERE uid = ? AND state = 'deleted'"
      : "SELECT * FROM worlds_metadata WHERE uid = ? AND state != 'deleted'",
    [worldUid],
  );
}

function requireWorldAccess(
  auth: Awaited<ReturnType<typeof authorize>>,
  row: WorldRow,
  worldUid: string,
  requiredScope?: string,
): Response | null {
  if (auth.admin) return null;
  if (!auth.namespace || auth.namespace !== row.namespace)
    return unauthorized();
  if (auth.worldId && auth.worldId !== worldUid) return forbidden();
  if (requiredScope && !hasScope(auth, requiredScope))
    return forbiddenScope(requiredScope);
  return null;
}

const listRoute = createRoute({
  method: "get",
  path: "/worlds",
  tags: ["Worlds"],
  operationId: "listWorlds",
  summary: "List worlds",
  description:
    "List all worlds accessible to the authenticated token. Admin tokens see all worlds; namespace-scoped tokens see only their namespace's worlds.",
  "x-mint": { metadata: { title: "List worlds" } },
  security: [{ bearerWorldsToken: [] }],
  request: { query: worldsListQuery },
  responses: {
    200: {
      description: "World list",
      content: {
        "application/json": {
          schema: z.object({ worlds: z.array(WorldResourceSchema) }),
        },
      },
    },
  },
});

const createRouteDef = createRoute({
  method: "post",
  path: "/worlds",
  tags: ["Worlds"],
  operationId: "createWorld",
  summary: "Create world",
  description:
    "Create a new world. Provisions a dedicated per-world LibSQL database and initializes the search and vector indexes.",
  "x-mint": { metadata: { title: "Create world" } },
  security: [{ bearerWorldsToken: [] }],
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: CreateWorldRequestSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Created World",
      content: {
        "application/json": { schema: WorldResourceSchema },
      },
    },
    400: {
      description: "Bad request",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
    429: {
      description: "Organization database limit reached",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
    502: {
      description: "Provisioning failed",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/worlds/{id}",
  tags: ["Worlds"],
  operationId: "getWorld",
  summary: "Get world",
  description:
    "Retrieve a single world by its unique identifier. Returns the full WorldResource including state, storage backend, and search configuration.",
  "x-mint": { metadata: { title: "Get world" } },
  security: [{ bearerWorldsToken: [] }],
  request: { params: worldIdParam },
  responses: {
    200: {
      description: "World",
      content: {
        "application/json": { schema: WorldResourceSchema },
      },
    },
    404: {
      description: "Not found",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
  },
});

const updateRoute = createRoute({
  method: "patch",
  path: "/worlds/{id}",
  tags: ["Worlds"],
  operationId: "updateWorld",
  summary: "Update world",
  description:
    "Update a world's display name, embedding model, or search configuration. Changing the embedding model triggers a reindex.",
  "x-mint": { metadata: { title: "Update world" } },
  security: [{ bearerWorldsToken: [] }],
  request: {
    params: worldIdParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: UpdateWorldRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Updated World",
      content: {
        "application/json": { schema: WorldResourceSchema },
      },
    },
    400: {
      description: "Bad request",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
    404: {
      description: "Not found",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/worlds/{id}",
  tags: ["Worlds"],
  operationId: "deleteWorld",
  summary: "Delete world",
  description:
    "Soft-delete a world. The world enters a 30-day grace period during which it can be restored via undelete. After the grace period, the world is permanently purged.",
  "x-mint": { metadata: { title: "Delete world" } },
  security: [{ bearerWorldsToken: [] }],
  request: { params: worldIdParam },
  responses: {
    204: { description: "Deleted" },
    404: {
      description: "Not found",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
  },
});

const undeleteRoute = createRoute({
  method: "post",
  path: "/worlds/{id}/undelete",
  tags: ["Worlds"],
  operationId: "undeleteWorld",
  summary: "Undelete world",
  description:
    "Restore a soft-deleted world within its 30-day grace period. Returns the restored WorldResource. Fails if the grace period has expired.",
  "x-mint": { metadata: { title: "Undelete world" } },
  security: [{ bearerWorldsToken: [] }],
  request: { params: worldIdParam },
  responses: {
    200: {
      description: "Restored World",
      content: {
        "application/json": { schema: WorldResourceSchema },
      },
    },
    404: {
      description: "Not found",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
    409: {
      description: "Restore blocked",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
  },
});

const suspendRoute = createRoute({
  method: "post",
  path: "/worlds/{id}/suspend",
  tags: ["Worlds"],
  operationId: "suspendWorld",
  summary: "Suspend world",
  description:
    "Suspend a world, temporarily blocking all read and write operations. The world can be resumed later without data loss.",
  "x-mint": { metadata: { title: "Suspend world" } },
  security: [{ bearerWorldsToken: [] }],
  request: { params: worldIdParam },
  responses: {
    200: {
      description: "Suspended World",
      content: {
        "application/json": { schema: WorldResourceSchema },
      },
    },
    404: {
      description: "Not found",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
  },
});

const resumeRoute = createRoute({
  method: "post",
  path: "/worlds/{id}/resume",
  tags: ["Worlds"],
  operationId: "resumeWorld",
  summary: "Resume world",
  description:
    "Resume a suspended world, restoring full read and write access.",
  "x-mint": { metadata: { title: "Resume world" } },
  security: [{ bearerWorldsToken: [] }],
  request: { params: worldIdParam },
  responses: {
    200: {
      description: "Resumed World",
      content: {
        "application/json": { schema: WorldResourceSchema },
      },
    },
    404: {
      description: "Not found",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
  },
});

const namespaceDeleteRoute = createRoute({
  method: "post",
  path: "/admin/namespaces/{namespace}/delete",
  tags: ["Admin"],
  operationId: "deleteNamespaceWorlds",
  summary: "Mark all worlds for a namespace deleted (account deletion)",
  description:
    "Admin-only. Soft-deletes all worlds in a namespace and revokes all API keys for that namespace. Used for account deletion workflows.",
  "x-mint": { metadata: { title: "Delete namespace worlds" } },
  security: [{ bearerWorldsToken: [] }],
  request: {
    params: z.object({
      namespace: z.string().openapi({
        param: { name: "namespace", in: "path", required: true },
      }),
    }),
  },
  responses: {
    200: {
      description: "Delete result",
      content: {
        "application/json": {
          schema: z.object({
            deletedWorlds: z.number().int(),
            revokedKeys: z.number().int(),
          }),
        },
      },
    },
    403: {
      description: "Forbidden",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
  },
});

const purgeRoute = createRoute({
  method: "post",
  path: "/admin/purge",
  tags: ["Admin"],
  operationId: "purgeWorlds",
  summary: "Run purge sweep on demand",
  description:
    "Admin-only. Triggers the purge sweep to permanently delete all worlds whose 30-day grace period has expired. Normally runs on a schedule; this endpoint forces an immediate sweep.",
  "x-mint": { metadata: { title: "Run purge sweep on demand" } },
  security: [{ bearerWorldsToken: [] }],
  responses: {
    200: {
      description: "Purge sweep result",
      content: {
        "application/json": {
          schema: z.object({
            purged: z.number().int(),
            failed: z.number().int(),
          }),
        },
      },
    },
    403: {
      description: "Forbidden",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
  },
});

export function registerWorldsRoutes(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(listRoute, async (c) => {
    const env = c.env as unknown as Env;
    const auth = await authorize(c.req.raw, env);
    const db = getDb(env);

    if (!auth.admin && !auth.namespace) return unauthorized();
    if (!hasScope(auth, SCOPE_DATA_READ))
      return forbiddenScope(SCOPE_DATA_READ);

    const rows = await query<WorldRow>(
      db,
      auth.admin
        ? "SELECT * FROM worlds_metadata WHERE state != 'deleted' ORDER BY create_time DESC"
        : "SELECT * FROM worlds_metadata WHERE namespace = ? AND state != 'deleted' ORDER BY create_time DESC",
      auth.admin ? [] : [auth.namespace!],
    );
    return respond(c, { worlds: rows.map(worldResource) });
  });

  app.openapi(createRouteDef, async (c) => {
    const env = c.env as unknown as Env;
    const auth = await authorize(c.req.raw, env);
    const body = c.req.valid("json");

    const namespace = auth.namespace;
    if (!namespace) {
      if (!auth.admin) return unauthorized();
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "A namespace-scoped API key is required to create a world",
          },
        },
        400,
      );
    }
    const accessErr = requireAccess(
      auth,
      namespace,
      undefined,
      SCOPE_DATA_WRITE,
    );
    if (accessErr) return accessErr;

    const db = getDb(env);

    const worldUid = `w_${uid()}`;

    let provisioned: Awaited<ReturnType<typeof provisionWorldDatabase>>;
    try {
      provisioned = await provisionWorldDatabase(env, worldUid);
    } catch (err: unknown) {
      if (err instanceof DatabaseLimitError) {
        return respond(
          c,
          {
            error: {
              code: "DATABASE_LIMIT_REACHED",
              message: err.message,
            },
          },
          429,
        );
      }
      return respond(
        c,
        {
          error: {
            code: "PROVISIONING_FAILED",
            message:
              err instanceof Error ? err.message : "Turso provisioning failed",
          },
        },
        502,
      );
    }

    const ref = {
      worldUid,
      namespace,
      databaseUrl: provisioned.url,
      databaseAuthToken: provisioned.authToken,
      embeddingModel: body.embeddingModel ?? "tfjs-universal-sentence-encoder",
      chunkSize: body.chunkSize ?? 1000,
      topK: body.topK ?? 20,
      minScore: body.minScore ?? 0.0,
    };

    try {
      await initializeWorldDatabase(ref);
    } catch (err: unknown) {
      await destroyWorldDatabase(env, provisioned.name).catch(() => undefined);
      return respond(
        c,
        {
          error: {
            code: "PROVISIONING_FAILED",
            message:
              err instanceof Error ? err.message : "World schema init failed",
          },
        },
        502,
      );
    }

    const ts = now();
    const displayName = body.displayName ?? worldUid;

    try {
      await execute(
        db,
        "INSERT INTO worlds_metadata (uid, namespace, display_name, state, database_url, database_auth_token, embedding_model, chunk_size, top_k, min_score, create_time, update_time) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          worldUid,
          namespace,
          displayName,
          provisioned.url,
          provisioned.authToken,
          ref.embeddingModel,
          ref.chunkSize,
          ref.topK,
          ref.minScore,
          ts,
          ts,
        ],
      );
    } catch (err: unknown) {
      await destroyWorldDatabase(env, provisioned.name).catch(() => undefined);
      throw err;
    }

    const row = await queryOne<WorldRow>(
      db,
      "SELECT * FROM worlds_metadata WHERE uid = ?",
      [worldUid],
    );
    return respond(c, worldResource(row!), 201);
  });

  app.openapi(getRoute, async (c) => {
    const env = c.env as unknown as Env;
    const worldUid = c.req.param("id");
    const auth = await authorize(c.req.raw, env);
    const db = getDb(env);

    const row = await resolveWorld(db, worldUid);
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
      worldUid,
      SCOPE_DATA_READ,
    );
    if (worldAccess) return worldAccess;

    return respond(c, worldResource(row));
  });

  app.openapi(updateRoute, async (c) => {
    const env = c.env as unknown as Env;
    const worldUid = c.req.param("id");
    const auth = await authorize(c.req.raw, env);
    const body = c.req.valid("json");
    const db = getDb(env);

    const row = await resolveWorld(db, worldUid);
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
      worldUid,
      SCOPE_DATA_WRITE,
    );
    if (worldAccess) return worldAccess;

    const setClauses: string[] = [];
    const setArgs: (string | number)[] = [];

    if (body.displayName) {
      setClauses.push("display_name = ?");
      setArgs.push(body.displayName);
    }
    if (body.embeddingModel) {
      setClauses.push("embedding_model = ?");
      setArgs.push(body.embeddingModel);
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

    if (setClauses.length === 0) {
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
    setArgs.push(now(), worldUid);

    await execute(
      db,
      `UPDATE worlds_metadata SET ${setClauses.join(", ")} WHERE uid = ?`,
      setArgs,
    );

    const updated = await queryOne<WorldRow>(
      db,
      "SELECT * FROM worlds_metadata WHERE uid = ?",
      [worldUid],
    );
    return respond(c, worldResource(updated!));
  });

  app.openapi(deleteRoute, async (c) => {
    const env = c.env as unknown as Env;
    const worldUid = c.req.param("id");
    const auth = await authorize(c.req.raw, env);
    const db = getDb(env);

    const row = await resolveWorld(db, worldUid);
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
      worldUid,
      SCOPE_DATA_WRITE,
    );
    if (worldAccess) return worldAccess;

    const ts = now();
    const expireTs = new Date(Date.now() + GRACE_MS).toISOString();

    await execute(
      db,
      "UPDATE worlds_metadata SET state = 'deleted', delete_time = ?, expire_time = ?, purge_status = 'pending', update_time = ? WHERE uid = ?",
      [ts, expireTs, ts, worldUid],
    );
    return c.body(null, 204) as any;
  });

  app.openapi(undeleteRoute, async (c) => {
    const env = c.env as unknown as Env;
    const worldUid = c.req.param("id");
    const auth = await authorize(c.req.raw, env);
    const db = getDb(env);

    const row = await resolveWorld(db, worldUid, true);
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
      worldUid,
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
      "UPDATE worlds_metadata SET state = 'active', delete_time = NULL, expire_time = NULL, purge_status = 'none', update_time = ? WHERE uid = ?",
      [ts, worldUid],
    );
    const restored = await queryOne<WorldRow>(
      db,
      "SELECT * FROM worlds_metadata WHERE uid = ?",
      [worldUid],
    );
    return respond(c, worldResource(restored!));
  });

  app.openapi(suspendRoute, async (c) => {
    const env = c.env as unknown as Env;
    const worldUid = c.req.param("id");
    const auth = await authorize(c.req.raw, env);
    const db = getDb(env);

    const row = await resolveWorld(db, worldUid);
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
      worldUid,
      SCOPE_DATA_WRITE,
    );
    if (worldAccess) return worldAccess;

    await execute(
      db,
      "UPDATE worlds_metadata SET state = 'suspended', update_time = ? WHERE uid = ?",
      [now(), worldUid],
    );
    const suspended = await queryOne<WorldRow>(
      db,
      "SELECT * FROM worlds_metadata WHERE uid = ?",
      [worldUid],
    );
    return respond(c, worldResource(suspended!));
  });

  app.openapi(resumeRoute, async (c) => {
    const env = c.env as unknown as Env;
    const worldUid = c.req.param("id");
    const auth = await authorize(c.req.raw, env);
    const db = getDb(env);

    const row = await resolveWorld(db, worldUid);
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
      worldUid,
      SCOPE_DATA_WRITE,
    );
    if (worldAccess) return worldAccess;

    await execute(
      db,
      "UPDATE worlds_metadata SET state = 'active', update_time = ? WHERE uid = ?",
      [now(), worldUid],
    );
    const resumed = await queryOne<WorldRow>(
      db,
      "SELECT * FROM worlds_metadata WHERE uid = ?",
      [worldUid],
    );
    return respond(c, worldResource(resumed!));
  });

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
      "UPDATE worlds_metadata SET state = 'deleted', delete_time = ?, expire_time = ?, purge_status = 'pending', update_time = ? WHERE namespace = ? AND state != 'deleted' AND purge_status != 'purged'",
      [ts, expireTs, ts, namespace],
    );

    // Revoke every data-plane key for the namespace so credentials stop
    // working immediately even before the grace period elapses.
    const keyResult = await execute(
      db,
      "UPDATE api_keys SET revoked_at = ? WHERE namespace = ? AND revoked_at IS NULL",
      [ts, namespace],
    );

    return respond(c, {
      deletedWorlds: worldResult.rowsAffected,
      revokedKeys: keyResult.rowsAffected,
    });
  });

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
