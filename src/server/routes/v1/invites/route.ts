import { Router } from "@fartlabs/rt";
import { ulid } from "@std/ulid";
import { authorizeRequest } from "#/server/middleware/auth.ts";
import type { AppContext } from "#/server/app-context.ts";
import { paginationParamsSchema } from "#/sdk/utils.ts";
import {
  createInviteParamsSchema,
  inviteRecordSchema,
} from "#/sdk/invites/schema.ts";
import {
  invitesAdd,
  invitesDelete,
  invitesFind,
  invitesGetMany,
} from "#/server/db/resources/invites/queries.sql.ts";
import {
  inviteTableInsertSchema,
  inviteTableSchema,
} from "#/server/db/resources/invites/schema.ts";
import { ErrorResponse } from "#/server/errors.ts";

export default (appContext: AppContext) =>
  new Router()
    .get(
      "/v1/invites",
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
          sql: invitesGetMany,
          args: [pageSize, offset],
        });

        // Validate each SQL result row
        const validatedRows = result.rows.map((row) => {
          const validated = inviteTableSchema.parse({
            code: row.code,
            created_at: row.created_at,
            redeemed_by: row.redeemed_by,
            redeemed_at: row.redeemed_at,
          });

          return inviteRecordSchema.parse({
            code: validated.code,
            createdAt: validated.created_at,
            redeemedBy: validated.redeemed_by,
            redeemedAt: validated.redeemed_at,
          });
        });

        return Response.json(validatedRows);
      },
    )
    .post(
      "/v1/invites",
      async (ctx) => {
        const authorized = authorizeRequest(appContext, ctx.request);
        if (!authorized.admin) {
          return ErrorResponse.Unauthorized();
        }

        let body = {};
        try {
          body = await ctx.request.json();
        } catch {
          // Empty body is allowed, default code will be generated
        }

        const parseResult = createInviteParamsSchema.safeParse(body);
        if (!parseResult.success) {
          return ErrorResponse.BadRequest(
            "Invalid parameters: " +
              parseResult.error.issues.map((e: { message: string }) =>
                e.message
              ).join(", "),
          );
        }

        const code = parseResult.data.code ?? ulid();
        const now = Date.now();
        const invite = inviteTableInsertSchema.parse({
          code: code,
          created_at: now,
          redeemed_by: null,
          redeemed_at: null,
        });

        try {
          await appContext.libsqlClient.execute({
            sql: invitesAdd,
            args: [
              invite.code,
              invite.created_at,
              invite.redeemed_by ?? null,
              invite.redeemed_at ?? null,
            ],
          });
        } catch (e: unknown) {
          console.error("SQL Insert failed:", e);
          const message = e instanceof Error ? e.message : "Unknown error";
          return ErrorResponse.InternalServerError(
            "Failed to create invite: " + message,
          );
        }

        const record = inviteRecordSchema.parse({
          code: invite.code,
          createdAt: invite.created_at,
          redeemedBy: invite.redeemed_by,
          redeemedAt: invite.redeemed_at,
        });

        return Response.json(record, { status: 201 });
      },
    )
    .get(
      "/v1/invites/:code",
      async (ctx) => {
        const authorized = authorizeRequest(appContext, ctx.request);
        if (!authorized.admin) {
          return ErrorResponse.Unauthorized();
        }

        const code = ctx.params?.pathname.groups.code;
        if (!code) {
          return ErrorResponse.BadRequest("Invite code required");
        }

        const result = await appContext.libsqlClient.execute({
          sql: invitesFind,
          args: [code],
        });

        const row = result.rows[0];
        if (!row) {
          return ErrorResponse.NotFound("Invite not found");
        }

        // Validate SQL result
        const validated = inviteTableSchema.parse({
          code: row.code,
          created_at: row.created_at,
          redeemed_by: row.redeemed_by,
          redeemed_at: row.redeemed_at,
        });

        const record = inviteRecordSchema.parse({
          code: validated.code,
          createdAt: validated.created_at,
          redeemedBy: validated.redeemed_by,
          redeemedAt: validated.redeemed_at,
        });

        return Response.json(record);
      },
    )
    .delete(
      "/v1/invites/:code",
      async (ctx) => {
        const authorized = authorizeRequest(appContext, ctx.request);
        if (!authorized.admin) {
          return ErrorResponse.Unauthorized();
        }

        const code = ctx.params?.pathname.groups.code;
        if (!code) {
          return ErrorResponse.BadRequest("Invite code required");
        }

        await appContext.libsqlClient.execute({
          sql: invitesDelete,
          args: [code],
        });

        return new Response(null, { status: 204 });
      },
    );
