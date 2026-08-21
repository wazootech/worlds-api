import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../env";
import { getDb, execute, query, uid, now } from "../lib/db";
import { sha256Hex, createToken } from "../lib/crypto";
import { authorize } from "../lib/auth";
import { respond } from "../lib/respond";
import {
  ApiKeyCreateRequestSchema,
  ApiKeyCreateResponseSchema,
  ApiKeyResourceSchema,
  keyIdParam,
  apiKeysListQuery,
} from "../lib/schemas";

interface ApiKeyRow {
  uid: string;
  name: string;
  namespace: string;
  world_id: string | null;
  scopes: string;
  create_time: string;
  revoked_at: string | null;
}

export function registerApiKeysRoutes(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(
    createRoute({
      method: "post",
      path: "/api-keys",
      tags: ["APIKeys"],
      operationId: "createApiKey",
      summary: "Create API key",
      description:
        "Create a new API key scoped to a namespace and optionally a single world. The token is returned once on creation and cannot be retrieved again.",
      "x-mint": { metadata: { title: "Create API key" } },
      security: [{ bearerWorldsToken: [] }],
      request: {
        body: {
          required: true,
          content: {
            "application/json": { schema: ApiKeyCreateRequestSchema },
          },
        },
      },
      responses: {
        201: {
          description: "Created API key",
          content: {
            "application/json": { schema: ApiKeyCreateResponseSchema },
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
    }),
    async (c) => {
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
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api-keys",
      tags: ["APIKeys"],
      operationId: "listApiKeys",
      summary: "List API keys",
      description:
        "List all active (non-revoked) API keys. Optionally filter by namespace. Admin-only.",
      "x-mint": { metadata: { title: "List API keys" } },
      security: [{ bearerWorldsToken: [] }],
      request: { query: apiKeysListQuery },
      responses: {
        200: {
          description: "API keys list",
          content: {
            "application/json": {
              schema: z.object({ keys: z.array(ApiKeyResourceSchema) }),
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
    }),
    async (c) => {
      const env = c.env as unknown as Env;
      const auth = await authorize(c.req.raw, env);

      if (!auth.admin) {
        return respond(
          c,
          {
            error: {
              code: "FORBIDDEN",
              message: "Only admin keys can list API keys",
            },
          },
          403,
        );
      }

      const query_ = c.req.valid("query");
      const db = getDb(env);

      let sql =
        "SELECT uid, name, namespace, world_id, scopes, create_time FROM api_keys WHERE revoked_at IS NULL";
      const params: Array<string> = [];

      if (query_.namespace) {
        sql += " AND namespace = ?";
        params.push(query_.namespace);
      }

      sql += " ORDER BY create_time DESC";

      const rows = await query<ApiKeyRow>(db, sql, params);

      return respond(c, {
        keys: rows.map((r) => ({
          uid: r.uid,
          name: r.name,
          namespace: r.namespace,
          worldId: r.world_id ?? undefined,
          scopes: JSON.parse(r.scopes),
          createTime: r.create_time,
        })),
      });
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api-keys/{keyId}",
      tags: ["APIKeys"],
      operationId: "deleteApiKey",
      summary: "Revoke API key",
      description:
        "Permanently revoke an API key. The key immediately loses all access. This action cannot be undone.",
      "x-mint": { metadata: { title: "Revoke API key" } },
      request: { params: keyIdParam },
      responses: {
        204: { description: "Revoked" },
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
    }),
    async (c) => {
      const env = c.env as unknown as Env;
      const auth = await authorize(c.req.raw, env);

      if (!auth.admin) {
        return respond(
          c,
          {
            error: {
              code: "FORBIDDEN",
              message: "Only admin keys can revoke API keys",
            },
          },
          403,
        );
      }

      const keyId = c.req.param("keyId");
      const db = getDb(env);
      const ts = now();

      const result = await execute(
        db,
        "UPDATE api_keys SET revoked_at = ? WHERE uid = ? AND revoked_at IS NULL",
        [ts, keyId],
      );

      if (result.rowsAffected === 0) {
        return respond(
          c,
          { error: { code: "NOT_FOUND", message: "API key not found" } },
          404,
        );
      }

      return c.body(null, 204) as any;
    },
  );
}
