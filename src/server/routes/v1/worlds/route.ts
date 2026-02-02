import { Router } from "@fartlabs/rt";
import { authorizeRequest } from "#/server/middleware/auth.ts";
import type { AppContext } from "#/server/app-context.ts";
// import { LibsqlSearchStoreManager } from "#/server/search/libsql.ts";
import {
  createWorldParamsSchema,
  updateWorldParamsSchema,
  worldRecordSchema,
} from "#/sdk/worlds/schema.ts";
import { paginationParamsSchema } from "#/sdk/utils.ts";
import { Parser, Store, Writer } from "n3";
import {
  deleteWorld,
  insertWorld,
  selectWorldById,
  selectWorldByIdWithBlob,
  selectWorldsByOrganizationId,
  updateWorld,
} from "#/server/db/resources/worlds/queries.sql.ts";
import {
  worldRowSchema,
  worldTableInsertSchema,
  worldTableSchema,
  worldTableUpdateSchema,
} from "#/server/db/resources/worlds/schema.ts";
import { ErrorResponse } from "#/server/errors.ts";

const SERIALIZATIONS: Record<string, { contentType: string; format: string }> =
  {
    "turtle": { contentType: "text/turtle", format: "Turtle" },
    "n-quads": { contentType: "application/n-quads", format: "N-Quads" },
    "n-triples": { contentType: "application/n-triples", format: "N-Triples" },
    "n3": { contentType: "text/n3", format: "N3" },
  };

const DEFAULT_SERIALIZATION = SERIALIZATIONS["n-quads"];

export default (appContext: AppContext) => {
  return new Router()
    .get(
      "/v1/worlds/:world",
      async (ctx) => {
        const worldId = ctx.params?.pathname.groups.world;
        if (!worldId) {
          return ErrorResponse.BadRequest("World ID required");
        }

        const authorized = authorizeRequest(appContext, ctx.request);
        if (!authorized.admin) {
          return ErrorResponse.Unauthorized();
        }

        const result = await appContext.libsqlClient.execute({
          sql: selectWorldById,
          args: [worldId],
        });
        const world = result.rows[0];

        if (!world || world.deleted_at != null) {
          return ErrorResponse.NotFound("World not found");
        }

        // Validate SQL result before returning
        const row = worldRowSchema.parse({
          id: world.id,
          organization_id: world.organization_id,
          label: world.label,
          description: world.description,
          db_hostname: world.db_hostname,
          db_token: world.db_token,
          created_at: world.created_at,
          updated_at: world.updated_at,
          deleted_at: world.deleted_at,
        });

        // Map to SDK record and validate against SDK schema
        const record = worldRecordSchema.parse({
          id: row.id,
          organizationId: row.organization_id,
          label: row.label,
          description: row.description,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          deletedAt: row.deleted_at,
        });

        return Response.json(record);
      },
    )
    .get(
      "/v1/worlds/:world/download",
      async (ctx) => {
        const worldId = ctx.params?.pathname.groups.world;
        if (!worldId) {
          return ErrorResponse.BadRequest("World ID required");
        }

        const authorized = authorizeRequest(appContext, ctx.request);
        if (!authorized.admin) {
          return ErrorResponse.Unauthorized();
        }

        const worldResult = await appContext.libsqlClient.execute({
          sql: selectWorldByIdWithBlob,
          args: [worldId],
        });
        const rawWorld = worldResult.rows[0];

        if (!rawWorld || rawWorld.deleted_at != null) {
          return ErrorResponse.NotFound("World not found");
        }

        // Validate SQL result
        const world = worldTableSchema.parse({
          id: rawWorld.id,
          organization_id: rawWorld.organization_id,
          label: rawWorld.label,
          description: rawWorld.description,
          blob: rawWorld.blob,
          db_hostname: rawWorld.db_hostname,
          db_token: rawWorld.db_token,
          created_at: rawWorld.created_at,
          updated_at: rawWorld.updated_at,
          deleted_at: rawWorld.deleted_at,
        });

        const url = new URL(ctx.request.url);
        const formatParam = url.searchParams.get("format");
        const acceptHeader = ctx.request.headers.get("Accept");

        let serialization = DEFAULT_SERIALIZATION;
        if (formatParam && SERIALIZATIONS[formatParam]) {
          serialization = SERIALIZATIONS[formatParam];
        } else if (acceptHeader) {
          const match = Object.values(SERIALIZATIONS).find((s) =>
            acceptHeader.includes(s.contentType)
          );
          if (match) {
            serialization = match;
          }
        }

        // worldResult.rows[0] is used to get the world record
        if (!world || !world.blob) {
          return ErrorResponse.NotFound("World data not found");
        }

        // world.blob is an ArrayBuffer from LibSQL
        const blobData = world.blob as ArrayBuffer;
        const worldString = new TextDecoder().decode(new Uint8Array(blobData));

        // If requested format is already N-Quads (our internal storage format), return as is
        if (serialization.format === "N-Quads") {
          return new Response(worldString, {
            headers: { "Content-Type": serialization.contentType },
          });
        }

        // Otherwise, re-serialize using n3
        try {
          const parser = new Parser({ format: "N-Quads" });
          const quads = parser.parse(worldString);
          const store = new Store();
          store.addQuads(quads);

          const writer = new Writer({ format: serialization.format });
          writer.addQuads(store.getQuads(null, null, null, null));
          const result = await new Promise<string>((resolve, reject) => {
            writer.end((error, result) => {
              if (error) reject(error);
              else resolve(result as string);
            });
          });

          return new Response(result, {
            headers: { "Content-Type": serialization.contentType },
          });
        } catch (error) {
          console.error("Serialization error:", error);
          return ErrorResponse.InternalServerError(
            "Failed to serialize world data",
          );
        }
      },
    )
    .put(
      "/v1/worlds/:world",
      async (ctx) => {
        const worldId = ctx.params?.pathname.groups.world;
        if (!worldId) {
          return ErrorResponse.BadRequest("World ID required");
        }

        const authorized = await authorizeRequest(appContext, ctx.request);
        if (!authorized.admin) {
          return ErrorResponse.Unauthorized();
        }

        const worldResult = await appContext.libsqlClient.execute({
          sql: selectWorldByIdWithBlob,
          args: [worldId],
        });
        const rawWorld = worldResult.rows[0];

        if (!rawWorld || rawWorld.deleted_at != null) {
          return ErrorResponse.NotFound("World not found");
        }

        // Validate SQL result
        const world = worldTableSchema.parse({
          id: rawWorld.id,
          organization_id: rawWorld.organization_id,
          label: rawWorld.label,
          description: rawWorld.description,
          blob: rawWorld.blob,
          db_hostname: rawWorld.db_hostname,
          db_token: rawWorld.db_token,
          created_at: rawWorld.created_at,
          updated_at: rawWorld.updated_at,
          deleted_at: rawWorld.deleted_at,
        });

        let body;
        try {
          body = await ctx.request.json();
        } catch {
          return ErrorResponse.BadRequest("Invalid JSON");
        }

        const parseResult = updateWorldParamsSchema.safeParse(body);
        if (!parseResult.success) {
          return ErrorResponse.BadRequest(
            "Invalid parameters: " +
              parseResult.error.issues.map((e: { message: string }) =>
                e.message
              ).join(", "),
          );
        }
        const data = parseResult.data;

        const updatedAt = Date.now();
        const worldUpdate = worldTableUpdateSchema.parse({
          label: data.label ?? world.label,
          description: data.description ?? world.description,
          updated_at: updatedAt,
          blob: world.blob,
        });

        await appContext.libsqlClient.execute({
          sql: updateWorld,
          args: [
            worldUpdate.label ?? world.label,
            worldUpdate.description ?? world.description ?? null,
            worldUpdate.updated_at ?? updatedAt,
            worldUpdate.blob ?? world.blob ?? null,
            world.db_hostname,
            world.db_token,
            worldId,
          ],
        });

        return new Response(null, { status: 204 });
      },
    )
    .delete(
      "/v1/worlds/:world",
      async (ctx) => {
        const worldId = ctx.params?.pathname.groups.world;
        if (!worldId) {
          return ErrorResponse.BadRequest("World ID required");
        }

        const authorized = await authorizeRequest(appContext, ctx.request);
        if (!authorized.admin) {
          return ErrorResponse.Unauthorized();
        }

        const worldResult = await appContext.libsqlClient.execute({
          sql: selectWorldById,
          args: [worldId],
        });
        const rawWorld = worldResult.rows[0];

        if (!rawWorld || rawWorld.deleted_at != null) {
          return ErrorResponse.NotFound("World not found");
        }

        // Validate SQL result
        const _world = worldRowSchema.parse({
          id: rawWorld.id,
          organization_id: rawWorld.organization_id,
          label: rawWorld.label,
          description: rawWorld.description,
          db_hostname: rawWorld.db_hostname,
          db_token: rawWorld.db_token,
          created_at: rawWorld.created_at,
          updated_at: rawWorld.updated_at,
          deleted_at: rawWorld.deleted_at,
        });

        if (appContext.libsqlManager) {
          try {
            // Database ID is the same as World ID
            await appContext.libsqlManager.delete(worldId);
          } catch (error) {
            console.error("Failed to delete Turso database:", error);
          }
        }

        if (appContext.libsqlManager) {
          try {
            // Database ID is the same as World ID
            await appContext.libsqlManager.delete(worldId);
          } catch (error) {
            console.error("Failed to delete Turso database:", error);
          }
        }

        try {
          // Delete world
          await appContext.libsqlClient.execute({
            sql: deleteWorld,
            args: [worldId],
          });
          return new Response(null, { status: 204 });
        } catch (error) {
          console.error("Failed to delete world:", error);
          return ErrorResponse.InternalServerError();
        }
      },
    )
    .get(
      "/v1/worlds",
      async (ctx) => {
        const authorized = await authorizeRequest(appContext, ctx.request);
        if (!authorized.admin) {
          return ErrorResponse.Unauthorized();
        }

        const url = new URL(ctx.request.url);
        // Admin must specify organizationId to list worlds for that organization
        const organizationId = url.searchParams.get("organizationId");
        if (!organizationId) {
          return ErrorResponse.BadRequest(
            "organizationId query parameter is required",
          );
        }

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
          sql: selectWorldsByOrganizationId,
          args: [organizationId, pageSize, offset],
        });

        // Validate each SQL result row
        const validatedRows = result.rows.map((row) => {
          const validated = worldRowSchema.parse({
            id: row.id,
            organization_id: row.organization_id,
            label: row.label,
            description: row.description,
            db_hostname: row.db_hostname,
            db_token: row.db_token,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
          });

          return worldRecordSchema.parse({
            id: validated.id,
            organizationId: validated.organization_id,
            label: validated.label,
            description: validated.description,
            createdAt: validated.created_at,
            updatedAt: validated.updated_at,
            deletedAt: validated.deleted_at,
          });
        });

        return Response.json(validatedRows);
      },
    )
    .post(
      "/v1/worlds",
      async (ctx) => {
        const authorized = await authorizeRequest(appContext, ctx.request);
        if (!authorized.admin) {
          return ErrorResponse.Unauthorized();
        }

        let body;
        try {
          body = await ctx.request.json();
        } catch {
          return ErrorResponse.BadRequest("Invalid JSON");
        }

        const parseResult = createWorldParamsSchema.safeParse(body);
        if (!parseResult.success) {
          return ErrorResponse.BadRequest(
            "Invalid parameters: " +
              parseResult.error.issues.map((e: { message: string }) =>
                e.message
              ).join(", "),
          );
        }
        const data = parseResult.data;

        // No rate limits check

        const now = Date.now();
        const worldId = crypto.randomUUID();

        let _dbId: string | null = null;
        const dbHostname: string | null = null; // Stored as null, use LibsqlManager.get()
        const dbToken: string | null = null; // Stored as null, use LibsqlManager.get()

        if (appContext.libsqlManager) {
          try {
            const client = await appContext.libsqlManager.create(worldId);
            _dbId = worldId; // The ID passed to create is the database ID

            const { initializeDatabase } = await import("#/server/db/init.ts");
            await initializeDatabase(client);
          } catch (error) {
            console.error("Failed to provision Turso database:", error);
            return ErrorResponse.InternalServerError(
              "Failed to provision world database",
            );
          }
        }

        const world = worldTableInsertSchema.parse({
          id: worldId,
          organization_id: data.organizationId,
          label: data.label,
          description: data.description ?? null,
          blob: null,
          db_hostname: dbHostname,
          db_token: dbToken,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        });

        await appContext.libsqlClient.execute({
          sql: insertWorld,
          args: [
            world.id,
            world.organization_id,
            world.label,
            world.description ?? null,
            world.blob ?? null,
            world.db_hostname,
            world.db_token,
            world.created_at,
            world.updated_at,
            world.deleted_at ?? null,
          ],
        });

        const record = worldRecordSchema.parse({
          id: world.id,
          organizationId: world.organization_id,
          label: world.label,
          description: world.description,
          createdAt: world.created_at,
          updatedAt: world.updated_at,
          deletedAt: world.deleted_at,
        });

        return Response.json(record, { status: 201 });
      },
    );
};
