import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../env";
import { getDb, query, queryOne, execute, uid, now } from "../lib/db";
import { authorize, requireAccess, unauthorized } from "../lib/auth";
import { initializeWorldDatabase } from "../lib/world-db";
import { respond } from "../lib/respond";
import {
  WorldResourceSchema,
  CreateWorldRequestSchema,
  UpdateWorldRequestSchema,
  UndeleteWorldRequestSchema,
  worldIdParam,
  worldsListQuery,
  worldGetQuery,
  worldDeleteQuery,
  namespaceQuery,
} from "../lib/schemas";

interface WorldRow {
  uid: string;
  namespace: string;
  world_id: string;
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
    name: `namespaces/${row.namespace}/worlds/${row.world_id}`,
    uid: row.uid,
    namespace: row.namespace,
    worldId: row.world_id,
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

function namespaceFor(
  auth: Awaited<ReturnType<typeof authorize>>,
  explicit?: string | null,
) {
  if (auth.admin) return explicit ?? null;
  return auth.namespace ?? null;
}

const listRoute = createRoute({
  method: "get",
  path: "/worlds",
  tags: ["Worlds"],
  operationId: "listWorlds",
  summary: "List worlds",
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
      description: "Already exists",
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
  security: [{ bearerWorldsToken: [] }],
  request: { params: worldIdParam, query: worldGetQuery },
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
  security: [{ bearerWorldsToken: [] }],
  request: { params: worldIdParam, query: worldDeleteQuery },
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
  security: [{ bearerWorldsToken: [] }],
  request: {
    params: worldIdParam,
    query: namespaceQuery,
    body: {
      content: {
        "application/json": { schema: UndeleteWorldRequestSchema },
      },
    },
  },
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

export function registerWorldsRoutes(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(listRoute, async (c) => {
    const env = c.env as unknown as Env;
    const auth = await authorize(c.req.raw, env);
    const listQuery = c.req.valid("query");
    const namespace = namespaceFor(auth, listQuery.namespace);
    if (!namespace) return unauthorized();

    const accessErr = requireAccess(auth, namespace);
    if (accessErr) return accessErr;

    const db = getDb(env);
    const rows = await query<WorldRow>(
      db,
      "SELECT * FROM worlds_metadata WHERE namespace = ? AND state != 'deleted' ORDER BY create_time DESC",
      [namespace],
    );
    return respond(c, { worlds: rows.map(worldResource) });
  });

  app.openapi(createRouteDef, async (c) => {
    const env = c.env as unknown as Env;
    const auth = await authorize(c.req.raw, env);
    const body = c.req.valid("json");
    const namespace = namespaceFor(auth, body.namespace);
    if (!namespace) return unauthorized();

    const accessErr = requireAccess(auth, namespace);
    if (accessErr) return accessErr;

    if (!body.worldId) {
      return respond(
        c,
        { error: { code: "INVALID_ARGUMENT", message: "worldId is required" } },
        400,
      );
    }

    const db = getDb(env);
    const worldUid = `w_${uid()}`;
    const ts = now();
    const displayName = body.displayName ?? body.worldId;

    if (!body.databaseUrl) {
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "databaseUrl is required for per-World libSQL storage",
          },
        },
        400,
      );
    }

    await initializeWorldDatabase({
      namespace,
      worldId: body.worldId,
      databaseUrl: body.databaseUrl,
      databaseAuthToken: body.databaseAuthToken,
      embeddingModel: body.embeddingModel ?? "tfjs-universal-sentence-encoder",
      chunkSize: body.chunkSize ?? 1000,
      topK: body.topK ?? 20,
      minScore: body.minScore ?? 0.0,
    });

    try {
      await execute(
        db,
        "INSERT INTO worlds_metadata (uid, namespace, world_id, display_name, state, database_url, database_auth_token, embedding_model, chunk_size, top_k, min_score, create_time, update_time) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          worldUid,
          namespace,
          body.worldId,
          displayName,
          body.databaseUrl,
          body.databaseAuthToken ?? null,
          body.embeddingModel ?? "tfjs-universal-sentence-encoder",
          body.chunkSize ?? 1000,
          body.topK ?? 20,
          body.minScore ?? 0.0,
          ts,
          ts,
        ],
      );

      return respond(
        c,
        worldResource({
          uid: worldUid,
          namespace,
          world_id: body.worldId,
          display_name: displayName,
          state: "active",
          database_url: body.databaseUrl,
          database_auth_token: body.databaseAuthToken ?? null,
          embedding_model:
            body.embeddingModel ?? "tfjs-universal-sentence-encoder",
          chunk_size: body.chunkSize ?? 1000,
          top_k: body.topK ?? 20,
          min_score: body.minScore ?? 0.0,
          delete_time: null,
          expire_time: null,
          create_time: ts,
          update_time: ts,
        }),
        201,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("UNIQUE constraint")) {
        return respond(
          c,
          {
            error: {
              code: "ALREADY_EXISTS",
              message: `World '${body.worldId}' already exists in namespace '${namespace}'`,
            },
          },
          409,
        );
      }
      throw err;
    }
  });

  app.openapi(getRoute, async (c) => {
    const env = c.env as unknown as Env;
    const worldId = c.req.param("id");
    const auth = await authorize(c.req.raw, env);
    const query = c.req.valid("query");
    const namespace = namespaceFor(auth, query.namespace);
    if (!namespace) return unauthorized();

    const accessErr = requireAccess(auth, namespace, worldId);
    if (accessErr) return accessErr;

    const db = getDb(env);
    const row = await queryOne<WorldRow>(
      db,
      "SELECT * FROM worlds_metadata WHERE namespace = ? AND world_id = ? AND state != 'deleted'",
      [namespace, worldId],
    );

    if (!row) {
      return respond(
        c,
        { error: { code: "NOT_FOUND", message: "World not found" } },
        404,
      );
    }

    return respond(c, worldResource(row));
  });

  app.openapi(updateRoute, async (c) => {
    const env = c.env as unknown as Env;
    const worldId = c.req.param("id");
    const auth = await authorize(c.req.raw, env);
    const body = c.req.valid("json");
    const namespace = namespaceFor(
      auth,
      body.namespace ?? c.req.query("namespace"),
    );
    if (!namespace) return unauthorized();

    if (!auth.admin && auth.namespace !== namespace) {
      return unauthorized();
    }

    const db = getDb(env);
    const ts = now();

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
    setArgs.push(ts, namespace, worldId);

    const result = await execute(
      db,
      `UPDATE worlds_metadata SET ${setClauses.join(", ")} WHERE namespace = ? AND world_id = ? AND state != 'deleted'`,
      setArgs,
    );

    if (result.rowsAffected === 0) {
      return respond(
        c,
        { error: { code: "NOT_FOUND", message: "World not found" } },
        404,
      );
    }

    const row = await queryOne<WorldRow>(
      db,
      "SELECT * FROM worlds_metadata WHERE namespace = ? AND world_id = ?",
      [namespace, worldId],
    );

    return respond(c, worldResource(row!));
  });

  app.openapi(deleteRoute, async (c) => {
    const env = c.env as unknown as Env;
    const worldId = c.req.param("id");
    const auth = await authorize(c.req.raw, env);
    const query = c.req.valid("query");
    const namespace = namespaceFor(auth, query.namespace);
    if (!namespace) return unauthorized();

    if (!auth.admin && auth.namespace !== namespace) {
      return unauthorized();
    }

    const db = getDb(env);
    const ts = now();
    const expireTs = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const result = await execute(
      db,
      "UPDATE worlds_metadata SET state = 'deleted', delete_time = ?, expire_time = ? WHERE namespace = ? AND world_id = ? AND state != 'deleted'",
      [ts, expireTs, namespace, worldId],
    );

    if (result.rowsAffected === 0) {
      return respond(
        c,
        { error: { code: "NOT_FOUND", message: "World not found" } },
        404,
      );
    }

    return c.body(null, 204) as any;
  });

  app.openapi(undeleteRoute, async (c) => {
    const env = c.env as unknown as Env;
    const worldId = c.req.param("id");
    const auth = await authorize(c.req.raw, env);
    let explicit: string | undefined;
    if (auth.admin) {
      const body = c.req.valid("json");
      explicit = body.namespace;
    }
    const query = c.req.valid("query");
    const namespace = namespaceFor(auth, explicit ?? query.namespace);
    if (!namespace) return unauthorized();

    if (!auth.admin && auth.namespace !== namespace) {
      return unauthorized();
    }

    const db = getDb(env);

    const row = await queryOne<WorldRow>(
      db,
      "SELECT * FROM worlds_metadata WHERE namespace = ? AND world_id = ? AND state = 'deleted'",
      [namespace, worldId],
    );

    if (!row) {
      return respond(
        c,
        {
          error: {
            code: "NOT_FOUND",
            message: "Deleted world not found",
          },
        },
        404,
      );
    }

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
      "UPDATE worlds_metadata SET state = 'active', delete_time = NULL, expire_time = NULL, update_time = ? WHERE uid = ?",
      [ts, row.uid],
    );

    const restored = await queryOne<WorldRow>(
      db,
      "SELECT * FROM worlds_metadata WHERE uid = ?",
      [row.uid],
    );

    return respond(c, worldResource(restored!));
  });
}
