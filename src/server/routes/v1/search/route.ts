import { Router } from "@fartlabs/rt";
import { authorizeRequest } from "#/server/middleware/auth.ts";
import type { AppContext } from "#/server/app-context.ts";
import { searchChunks } from "#/server/db/resources/chunks/queries.sql.ts";
import {
  selectWorldById,
  selectWorldsByOrganizationId,
} from "#/server/db/resources/worlds/queries.sql.ts";
import { limitParamSchema } from "#/sdk/utils.ts";
import { worldIdsParamSchema } from "#/sdk/worlds/schema.ts";
import { ErrorResponse } from "#/server/errors.ts";
import type { TripleSearchResult } from "#/sdk/worlds/schema.ts";

// TODO: Allow users to filter by subject and predicate.

export default (appContext: AppContext) => {
  return new Router().get(
    "/v1/search",
    async (ctx) => {
      const authorized = authorizeRequest(appContext, ctx.request);
      if (!authorized.admin) {
        return ErrorResponse.Unauthorized();
      }

      const url = new URL(ctx.request.url);
      const query = url.searchParams.get("q");
      const _subjects = url.searchParams.getAll("subjects");
      const _predicates = url.searchParams.getAll("predicates");

      if (!query) {
        return ErrorResponse.BadRequest("Query required");
      }

      // Admin must specify organizationId to search
      const organizationId = url.searchParams.get("organizationId");
      if (!organizationId) {
        return ErrorResponse.BadRequest("Organization ID required");
      }

      const worldIdsParam = url.searchParams.get("worlds");
      let worldIds: string[] | undefined;

      // Validate worldIds parameter if present
      if (worldIdsParam) {
        const worldIdsArray = worldIdsParam.split(",");
        const worldIdsResult = worldIdsParamSchema.safeParse(worldIdsArray);

        if (!worldIdsResult.success) {
          return ErrorResponse.BadRequest(
            "Invalid worlds parameter: too many IDs or invalid format",
          );
        }

        worldIds = worldIdsResult.data;
      }

      // If no worldIds provided, list all worlds for the organization
      if (!worldIds) {
        const result = await appContext.libsqlClient.execute({
          sql: selectWorldsByOrganizationId,
          args: [organizationId, 100, 0], // Max 100 worlds for now
        });
        console.error(
          `[DEBUG] Found ${result.rows.length} worlds for org ${organizationId}`,
        );
        worldIds = result.rows.map((row) => row.id as string);
      } else {
        // Validate specifically requested worlds belong to the organization
        const validWorldIds: string[] = [];
        for (const worldId of worldIds) {
          const worldResult = await appContext.libsqlClient.execute({
            sql: selectWorldById,
            args: [worldId],
          });
          const world = worldResult.rows[0];

          if (world && world.organization_id === organizationId) {
            validWorldIds.push(worldId);
          }
        }
        worldIds = validWorldIds;
      }

      if (worldIds.length === 0) {
        return Response.json([]);
      }

      const limitParam = url.searchParams.get("limit");
      let limit = 20;

      // Validate limit parameter if present
      if (limitParam) {
        const parsedLimit = parseInt(limitParam, 10);
        const limitResult = limitParamSchema.safeParse(parsedLimit);

        if (!limitResult.success) {
          return ErrorResponse.BadRequest(
            "Invalid limit parameter: must be a positive integer <= 100",
          );
        }

        limit = limitResult.data;
      }

      if (!appContext.libsqlManager) {
        return ErrorResponse.InternalServerError(
          "Search manager not available",
        );
      }

      try {
        const vector = await appContext.embeddings.embed(query);

        // Search across all target worlds in parallel
        const searchPromises = worldIds.map(async (worldId) => {
          try {
            const client = await appContext.libsqlManager!.get(worldId);

            const args = [
              new Uint8Array(new Float32Array(vector).buffer),
              limit,
              query,
              limit,
              limit,
            ];

            const result = await client.execute({
              sql: searchChunks,
              args,
            });

            const results: TripleSearchResult[] = result.rows.map((row) => ({
              subject: row.subject as string,
              predicate: row.predicate as string,
              object: row.object as string,
              vecRank: row.vec_rank as number | null,
              ftsRank: row.fts_rank as number | null,
              score: row.combined_rank as number,
            }));

            return results.map((r) => ({ ...r, worldId, organizationId }));
          } catch (error) {
            console.error(`Search error for world ${worldId}:`, error);
            return [];
          }
        });

        const allResults = (await Promise.all(searchPromises)).flat();

        // Sort by combined rank and limit
        const sortedResults = allResults
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);

        return Response.json(sortedResults);
      } catch (error) {
        console.error("Global search error:", error);
        return ErrorResponse.InternalServerError("Search failed");
      }
    },
  );
};
