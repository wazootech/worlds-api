import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../env";
import { execute, getDb, newWorldId, now, query, queryOne } from "../lib/db";
import {
  authorize,
  forbidden,
  forbiddenScope,
  hasScope,
  requireAccess,
  SCOPE_DATA_READ,
  SCOPE_DATA_WRITE,
  unauthorized,
} from "../lib/auth";
import { provisionWorld } from "../lib/d1-provision";
import { clearSdkCache, clearSdkCacheForWorld } from "../lib/world-db";
import { runPurgeSweep } from "../lib/purge";
import { getEmbeddingModel } from "../lib/embeddings/catalog";
import {
  getCredential,
  loadEmbeddingStatuses,
  revokeNamespaceCredentials,
  setWorldState,
  type EmbeddingStatus,
} from "../lib/embeddings/store";
import {
  cleanupOk,
  cleanupWorldVectors,
  emptyCleanupReport,
  mergeCleanupReports,
} from "../lib/embeddings/vectors";
import { respond } from "../lib/respond";
import {
  CreateWorldRequestSchema,
  UpdateWorldRequestSchema,
  worldIdParam,
  WorldResourceSchema,
  worldsListQuery,
} from "../lib/schemas";

const GRACE_MS = 30 * 24 * 60 * 60 * 1000;

interface WorldRow {
  world_id: string;
  namespace: string;
  display_name: string;
  state: string;
  embedding_model: string;
  chunk_size: number;
  top_k: number;
  min_score: number;
  delete_time: string | null;
  expire_time: string | null;
  purge_status: string;
  purged_at: string | null;
  create_time: string;
  update_time: string;
}

function worldResource(row: WorldRow, embeddingStatus: EmbeddingStatus) {
  return {
    id: row.world_id,
    displayName: row.display_name,
    state: row.state,
    storage: "d1" as const,
    embeddingModel: row.embedding_model,
    embeddingStatus,
    chunkSize: row.chunk_size,
    topK: row.top_k,
    minScore: row.min_score,
    createTime: row.create_time,
    updateTime: row.update_time,
    deleteTime: row.delete_time ?? undefined,
    expireTime: row.expire_time ?? undefined,
  };
}

async function resolveWorldRow(
  db: ReturnType<typeof getDb>,
  worldId: string,
  deleted = false,
): Promise<WorldRow | null> {
  return queryOne<WorldRow>(
    db,
    deleted
      ? "SELECT * FROM worlds WHERE world_id = ? AND state = 'deleted'"
      : "SELECT * FROM worlds WHERE world_id = ? AND state != 'deleted'",
    [worldId],
  );
}

async function statusFor(env: Env, row: WorldRow): Promise<EmbeddingStatus> {
  const statuses = await loadEmbeddingStatuses(env, [row]);
  return statuses.get(row.world_id) ?? "unconfigured";
}

function requireWorldAccess(
  auth: Awaited<ReturnType<typeof authorize>>,
  row: WorldRow,
  worldId: string,
  requiredScope?: string,
): Response | null {
  if (auth.admin) return null;
  if (!auth.namespace || auth.namespace !== row.namespace) {
    return unauthorized();
  }
  if (auth.worldId && auth.worldId !== worldId) return forbidden();
  if (requiredScope && !hasScope(auth, requiredScope)) {
    return forbiddenScope(requiredScope);
  }
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
    "Create a new World metadata record in the shared D1 database. Worlds API mints its ID as w_<ULID>; callers cannot choose the ID or a slug.",
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
    409: {
      description:
        "embeddingModel was given but the namespace has no active embedding credential (EMBEDDING_CREDENTIAL_REQUIRED).",
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
  path: "/worlds/{worldId}",
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
  path: "/worlds/{worldId}",
  tags: ["Worlds"],
  operationId: "updateWorld",
  summary: "Update world",
  description:
    "Update a world's display name, embedding model, or search configuration. Changing the embedding model marks the world stale (embeddingStatus stale): search runs keyword-only until POST /worlds/{worldId}/reindex is called. It does not reindex automatically, because reindexing spends the namespace's embedding budget. Setting a model requires an active embedding credential for the namespace.",
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
  path: "/worlds/{worldId}",
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
  path: "/worlds/{worldId}/undelete",
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
  path: "/worlds/{worldId}/suspend",
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
  path: "/worlds/{worldId}/resume",
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

const VectorCleanupSchema = z
  .object({
    worlds: z.number().int().nonnegative().openapi({
      description: "Worlds of the namespace whose vectors were cleaned.",
    }),
    attempted: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    incomplete: z.boolean().openapi({
      description:
        "True when vectors remain (a failure, or more than one request can remove). Calling the endpoint again is safe and continues; the purge sweep retries too.",
    }),
    errors: z.array(z.string()),
  })
  .openapi("VectorCleanupReport");

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
            vectorCleanup: VectorCleanupSchema.optional(),
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

/** Cleans the vectors of every world in a namespace. Never throws. */
async function cleanupNamespaceVectors(env: Env, namespace: string) {
  if (!env.VECTORIZE_INDEX) return undefined;
  let report = emptyCleanupReport(true);
  let worlds = 0;
  try {
    const rows = await query<{ world_id: string }>(
      getDb(env),
      "SELECT world_id FROM worlds WHERE namespace = ?",
      [namespace],
    );
    for (const row of rows ?? []) {
      const one = await cleanupWorldVectors(env, row.world_id, "all");
      report = mergeCleanupReports(report, one);
      if (one.attempted > 0) worlds++;
    }
  } catch (error) {
    report.failed += 1;
    report.errors.push(
      `enumerate: ${error instanceof Error ? error.name : "unknown"}`,
    );
  }
  if (!cleanupOk(report)) {
    console.warn("namespace vector cleanup incomplete", {
      namespace,
      failed: report.failed,
      incomplete: report.incomplete,
    });
  }
  return {
    worlds,
    attempted: report.attempted,
    deleted: report.deleted,
    failed: report.failed,
    incomplete: report.incomplete || report.failed > 0,
    errors: report.errors,
  };
}

export function registerWorldsRoutes(app: OpenAPIHono<{ Bindings: Env }>) {
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
    return respond(c, {
      worlds: (rows ?? []).map((row) =>
        worldResource(row, statuses.get(row.world_id) ?? "unconfigured"),
      ),
    });
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

    // Same rule as PATCH: choosing a model needs a usable credential.
    if (body.embeddingModel !== undefined) {
      const provider = getEmbeddingModel(body.embeddingModel)?.provider;
      const credential = provider
        ? await getCredential(env, namespace, provider)
        : null;
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
    }

    const worldId = newWorldId();

    const metadata = await provisionWorld(env, worldId, namespace, {
      displayName: body.displayName,
      embeddingModel: body.embeddingModel,
      chunkSize: body.chunkSize,
      topK: body.topK,
      minScore: body.minScore,
    });

    return respond(
      c,
      worldResource(
        metadata as WorldRow,
        await statusFor(env, metadata as WorldRow),
      ),
      201,
    );
  });

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

    return respond(c, worldResource(row, await statusFor(env, row)));
  });

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
      const provider = getEmbeddingModel(body.embeddingModel!)?.provider;
      const credential = provider
        ? await getCredential(env, row.namespace, provider)
        : null;
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
    setArgs.push(now(), worldId);

    await execute(
      db,
      `UPDATE worlds SET ${setClauses.join(", ")} WHERE world_id = ?`,
      setArgs,
    );

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
    return respond(c, worldResource(updated!, await statusFor(env, updated!)));
  });

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
    return c.body(null, 204) as any;
  });

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
      worldResource(restored!, await statusFor(env, restored!)),
    );
  });

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
      worldResource(suspended!, await statusFor(env, suspended!)),
    );
  });

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
    return respond(c, worldResource(resumed!, await statusFor(env, resumed!)));
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
