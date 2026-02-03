import { Router } from "@fartlabs/rt";
import { ulid } from "@std/ulid";
import { authorizeRequest } from "#/server/middleware/auth.ts";
import type { AppContext } from "#/server/app-context.ts";
import { paginationParamsSchema } from "#/sdk/utils.ts";
import {
  createOrganizationParamsSchema,
  organizationRecordSchema,
  updateOrganizationParamsSchema,
} from "#/sdk/organizations/schema.ts";
// import { LibsqlSearchStoreManager } from "#/server/search/libsql.ts";
import {
  organizationsAdd,
  organizationsDelete,
  organizationsFind,
  organizationsGetMany,
  organizationsRotateApiKey,
  organizationsUpdate,
} from "#/server/db/resources/organizations/queries.sql.ts";
import {
  organizationTableInsertSchema,
  organizationTableSchema,
  organizationTableUpdateSchema,
} from "#/server/db/resources/organizations/schema.ts";
import { ErrorResponse } from "#/server/errors.ts";

export default (appContext: AppContext) =>
  new Router()
    .get(
      "/v1/organizations",
      async (ctx) => {
        const authorized = authorizeRequest(appContext, ctx.request);
        if (!authorized.admin) {
          return ErrorResponse.Unauthorized();
        }

        const url = new URL(ctx.request.url);
        const pageString = url.searchParams.get("page") ?? "1";
        const pageSizeString = url.searchParams.get("pageSize") ?? "20";

        // Validate pagination parameters
        const paginationResult = paginationParamsSchema.safeParse({
          page: parseInt(pageString),
          pageSize: parseInt(pageSizeString),
        });

        if (!paginationResult.success) {
          return ErrorResponse.BadRequest(
            "Invalid pagination parameters: " +
              paginationResult.error.issues.map((e: { message: string }) =>
                e.message
              ).join(", "),
          );
        }

        const { page, pageSize } = paginationResult.data;
        const offset = (page - 1) * pageSize;

        const result = await appContext.libsqlClient.execute({
          sql: organizationsGetMany,
          args: [pageSize, offset],
        });

        // Validate each SQL result row
        const validatedRows = result.rows.map((row) => {
          const validated = organizationTableSchema.parse({
            id: row.id,
            label: row.label,
            description: row.description,
            plan: row.plan,
            api_key: row.api_key,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
          });

          return organizationRecordSchema.parse({
            id: validated.id,
            label: validated.label,
            description: validated.description,
            plan: validated.plan,
            apiKey: validated.api_key,
            createdAt: validated.created_at,
            updatedAt: validated.updated_at,
            deletedAt: validated.deleted_at,
          });
        });

        return Response.json(validatedRows);
      },
    )
    .post(
      "/v1/organizations",
      async (ctx) => {
        const authorized = authorizeRequest(appContext, ctx.request);
        if (!authorized.admin) {
          return ErrorResponse.Unauthorized();
        }

        let body;
        try {
          body = await ctx.request.json();
        } catch {
          return ErrorResponse.BadRequest("Invalid JSON");
        }

        const parseResult = createOrganizationParamsSchema.safeParse(body);
        if (!parseResult.success) {
          return ErrorResponse.BadRequest(
            "Invalid parameters: " +
              parseResult.error.issues.map((e: { message: string }) =>
                e.message
              ).join(", "),
          );
        }
        const { id, ...data } = parseResult.data;

        const apiKey = ulid();

        const now = Date.now();
        const organization = organizationTableInsertSchema.parse({
          id,
          label: data.label ?? null,
          description: data.description ?? null,
          plan: data.plan ?? null,
          api_key: apiKey,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        });

        try {
          await appContext.libsqlClient.execute({
            sql: organizationsAdd,
            args: [
              organization.id,
              organization.label ?? null,
              organization.description ?? null,
              organization.plan ?? null,
              organization.api_key,
              organization.created_at,
              organization.updated_at,
              organization.deleted_at ?? null,
            ],
          });
        } catch (e: unknown) {
          console.error("SQL Insert failed:", e);
          const message = e instanceof Error ? e.message : "Unknown error";
          return ErrorResponse.InternalServerError(
            "Failed to create organization: " + message,
          );
        }

        const record = organizationRecordSchema.parse({
          id: organization.id,
          label: organization.label,
          description: organization.description,
          plan: organization.plan,
          apiKey: organization.api_key,
          createdAt: organization.created_at,
          updatedAt: organization.updated_at,
          deletedAt: organization.deleted_at,
        });

        return Response.json(record, { status: 201 });
      },
    )
    .get(
      "/v1/organizations/:organization",
      async (ctx) => {
        const authorized = authorizeRequest(appContext, ctx.request);
        if (!authorized.admin) {
          return ErrorResponse.Unauthorized();
        }

        const organizationId = ctx.params?.pathname.groups.organization;
        if (!organizationId) {
          return ErrorResponse.BadRequest("Organization ID required");
        }

        const result = await appContext.libsqlClient.execute({
          sql: organizationsFind,
          args: [organizationId],
        });

        const row = result.rows[0];
        if (!row) {
          return ErrorResponse.NotFound("Organization not found");
        }

        // Validate SQL result
        const validated = organizationTableSchema.parse({
          id: row.id,
          label: row.label,
          description: row.description,
          plan: row.plan,
          api_key: row.api_key,
          created_at: row.created_at,
          updated_at: row.updated_at,
          deleted_at: row.deleted_at,
        });

        const record = organizationRecordSchema.parse({
          id: validated.id,
          label: validated.label,
          description: validated.description,
          plan: validated.plan,
          apiKey: validated.api_key,
          createdAt: validated.created_at,
          updatedAt: validated.updated_at,
          deletedAt: validated.deleted_at,
        });

        return Response.json(record);
      },
    )
    .put(
      "/v1/organizations/:organization",
      async (ctx) => {
        const authorized = authorizeRequest(appContext, ctx.request);
        if (!authorized.admin) {
          return ErrorResponse.Unauthorized();
        }

        const organizationId = ctx.params?.pathname.groups.organization;
        if (!organizationId) {
          return ErrorResponse.BadRequest("Organization ID required");
        }

        let body;
        try {
          body = await ctx.request.json();
        } catch {
          return ErrorResponse.BadRequest("Invalid JSON");
        }

        const parseResult = updateOrganizationParamsSchema.safeParse(body);
        if (!parseResult.success) {
          return ErrorResponse.BadRequest(
            "Invalid parameters: " +
              parseResult.error.issues.map((e: { message: string }) =>
                e.message
              ).join(", "),
          );
        }
        const data = parseResult.data;

        const updateNow = Date.now();
        const organizationUpdate = organizationTableUpdateSchema.parse({
          label: data.label ?? undefined,
          description: data.description ?? undefined,
          plan: data.plan ?? undefined,
          updated_at: updateNow,
        });

        await appContext.libsqlClient.execute({
          sql: organizationsUpdate,
          args: [
            organizationUpdate.label ?? null,
            organizationUpdate.description ?? null,
            organizationUpdate.plan ?? null,
            organizationUpdate.updated_at ?? updateNow,
            organizationId,
          ],
        });

        return new Response(null, { status: 204 });
      },
    )
    .delete(
      "/v1/organizations/:organization",
      async (ctx) => {
        const authorized = authorizeRequest(appContext, ctx.request);
        if (!authorized.admin) {
          return ErrorResponse.Unauthorized();
        }

        const organizationId = ctx.params?.pathname.groups.organization;
        if (!organizationId) {
          return ErrorResponse.BadRequest("Organization ID required");
        }

        // Cleanup search data
        // Cleanup search data
        // const searchStore = new LibsqlSearchStoreManager({
        //   client: appContext.libsqlClient,
        //   embeddings: appContext.embeddings,
        // });
        // await searchStore.createTablesIfNotExists();
        // await searchStore.deleteOrganization(organizationId);

        await appContext.libsqlClient.execute({
          sql: organizationsDelete,
          args: [organizationId],
        });

        return new Response(null, { status: 204 });
      },
    )
    .post(
      "/v1/organizations/:organization/rotate",
      async (ctx) => {
        const authorized = authorizeRequest(appContext, ctx.request);
        if (!authorized.admin) {
          return ErrorResponse.Unauthorized();
        }

        const organizationId = ctx.params?.pathname.groups.organization;
        if (!organizationId) {
          return ErrorResponse.BadRequest("Organization ID required");
        }

        const apiKey = ulid();
        await appContext.libsqlClient.execute({
          sql: organizationsRotateApiKey,
          args: [apiKey, Date.now(), organizationId],
        });

        return new Response(null, { status: 204 });
      },
    );
