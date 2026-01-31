import { Router } from "@fartlabs/rt";
import { ulid } from "@std/ulid";
import { authorizeRequest } from "#/server/middleware/auth.ts";
import type { AppContext } from "#/server/app-context.ts";
import {
  tenantsAdd,
  tenantsDelete,
  tenantsFind,
  tenantsGetMany,
  tenantsRotateApiKey,
  tenantsUpdate,
} from "#/server/db/resources/tenants/queries.sql.ts";
import {
  tenantTableInsertSchema,
  tenantTableUpdateSchema,
} from "#/server/db/resources/tenants/schema.ts";

const DEPRECATION_HEADERS = {
  "Warning":
    '299 - "The /v1/accounts API is deprecated and will be removed in a future version. Please use /v1/tenants instead."',
  "Deprecation": "true",
  "Link": '</v1/tenants>; rel="alternate"',
};

export default (appContext: AppContext) =>
  new Router()
    .get(
      "/v1/accounts",
      async (ctx) => {
        const authorized = await authorizeRequest(appContext, ctx.request);
        if (!authorized.tenant && !authorized.admin) {
          return new Response("Unauthorized", { status: 401 });
        }

        if (!authorized.admin) {
          return new Response("Forbidden: Admin access required", {
            status: 403,
          });
        }

        const url = new URL(ctx.request.url);
        const pageString = url.searchParams.get("page") ?? "1";
        const pageSizeString = url.searchParams.get("pageSize") ?? "20";
        const page = parseInt(pageString);
        const pageSize = parseInt(pageSizeString);
        const offset = (page - 1) * pageSize;

        const result = await appContext.libsqlClient.execute({
          sql: tenantsGetMany,
          args: [pageSize, offset],
        });

        return Response.json(
          result.rows.map((row) => ({
            id: row.id,
            description: row.description,
            plan: row.plan,
            apiKey: row.api_key,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            deletedAt: row.deleted_at,
          })),
          { headers: DEPRECATION_HEADERS },
        );
      },
    )
    .get(
      "/v1/accounts/:account",
      async (ctx) => {
        const authorized = await authorizeRequest(appContext, ctx.request);
        if (!authorized.tenant && !authorized.admin) {
          return new Response("Unauthorized", { status: 401 });
        }

        if (!authorized.admin) {
          return new Response("Forbidden: Admin access required", {
            status: 403,
          });
        }

        const tenantId = ctx.params?.pathname.groups.account;
        if (!tenantId) {
          return new Response("Account ID required", { status: 400 });
        }

        const result = await appContext.libsqlClient.execute({
          sql: tenantsFind,
          args: [tenantId],
        });

        const row = result.rows[0];
        if (!row) {
          return new Response("Account not found", { status: 404 });
        }

        return Response.json({
          id: row.id,
          description: row.description,
          plan: row.plan,
          apiKey: row.api_key,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          deletedAt: row.deleted_at,
        }, { headers: DEPRECATION_HEADERS });
      },
    )
    .put(
      "/v1/accounts/:account",
      async (ctx) => {
        const authorized = await authorizeRequest(appContext, ctx.request);
        if (!authorized.tenant && !authorized.admin) {
          return new Response("Unauthorized", { status: 401 });
        }

        if (!authorized.admin) {
          return new Response("Forbidden: Admin access required", {
            status: 403,
          });
        }

        const tenantId = ctx.params?.pathname.groups.account;
        if (!tenantId) {
          return new Response("Account ID required", { status: 400 });
        }

        const body = await ctx.request.json().catch(() => ({}));

        const updateNow = Date.now();
        const tenantUpdate = tenantTableUpdateSchema.parse({
          description: body.description ?? undefined,
          plan: body.plan ?? undefined,
          updated_at: updateNow,
        });

        await appContext.libsqlClient.execute({
          sql: tenantsUpdate,
          args: [
            tenantUpdate.description ?? null,
            tenantUpdate.plan ?? null,
            tenantUpdate.updated_at ?? updateNow,
            tenantId,
          ],
        });

        return new Response(null, {
          status: 204,
          headers: DEPRECATION_HEADERS,
        });
      },
    )
    .delete(
      "/v1/accounts/:account",
      async (ctx) => {
        const authorized = await authorizeRequest(appContext, ctx.request);
        if (!authorized.tenant && !authorized.admin) {
          return new Response("Unauthorized", { status: 401 });
        }

        if (!authorized.admin) {
          return new Response("Forbidden: Admin access required", {
            status: 403,
          });
        }

        const tenantId = ctx.params?.pathname.groups.account;
        if (!tenantId) {
          return new Response("Account ID required", { status: 400 });
        }

        await appContext.libsqlClient.execute({
          sql: tenantsDelete,
          args: [tenantId],
        });

        return new Response(null, {
          status: 204,
          headers: DEPRECATION_HEADERS,
        });
      },
    )
    .post(
      "/v1/accounts/:account/rotate",
      async (ctx) => {
        const authorized = await authorizeRequest(appContext, ctx.request);
        if (!authorized.tenant && !authorized.admin) {
          return new Response("Unauthorized", { status: 401 });
        }

        const tenantId = ctx.params?.pathname.groups.account;
        if (!tenantId) {
          return new Response("Account ID required", { status: 400 });
        }

        if (!authorized.admin && authorized.tenant?.id !== tenantId) {
          return new Response("Forbidden: Permission denied", { status: 403 });
        }

        const apiKey = ulid();
        await appContext.libsqlClient.execute({
          sql: tenantsRotateApiKey,
          args: [apiKey, Date.now(), tenantId],
        });

        return new Response(null, {
          status: 204,
          headers: DEPRECATION_HEADERS,
        });
      },
    )
    .post(
      "/v1/accounts",
      async (ctx) => {
        const authorized = await authorizeRequest(appContext, ctx.request);
        if (!authorized.tenant && !authorized.admin) {
          return new Response("Unauthorized", { status: 401 });
        }

        if (!authorized.admin) {
          return new Response("Forbidden: Admin access required", {
            status: 403,
          });
        }

        let body;
        try {
          body = await ctx.request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const id = body.id ?? ulid();
        const apiKey = ulid();
        const now = Date.now();

        const tenant = tenantTableInsertSchema.parse({
          id,
          description: body.description ?? null,
          plan: body.plan ?? null,
          api_key: apiKey,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        });

        await appContext.libsqlClient.execute({
          sql: tenantsAdd,
          args: [
            tenant.id,
            tenant.description ?? null,
            tenant.plan ?? null,
            tenant.api_key,
            tenant.created_at,
            tenant.updated_at,
            tenant.deleted_at ?? null,
          ],
        });

        return Response.json({
          id: tenant.id,
          description: tenant.description,
          plan: tenant.plan,
          apiKey: tenant.api_key,
          createdAt: tenant.created_at,
          updatedAt: tenant.updated_at,
          deletedAt: tenant.deleted_at,
        }, {
          status: 201,
          headers: DEPRECATION_HEADERS,
        });
      },
    );
