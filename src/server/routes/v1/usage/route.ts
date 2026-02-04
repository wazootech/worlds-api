import { Router } from "@fartlabs/rt";
import { authorizeRequest } from "#/server/middleware/auth.ts";
import { checkRateLimit } from "#/server/middleware/rate-limit-policy.ts";
import type { AppContext } from "#/server/app-context.ts";
import { ErrorResponse } from "#/server/errors.ts";
import { UsageService } from "#/server/databases/core/usage/service.ts";

/**
 * GET /v1/usage - Query usage/metering data.
 * Optional query params: organizationId, worldId to scope results.
 * Usage table not yet implemented; returns empty array until persistence is added.
 */
export default (appContext: AppContext) => {
  return new Router().get(
    "/v1/usage",
    async (ctx) => {
      const authorized = await authorizeRequest(appContext, ctx.request);
      if (!authorized.admin && !authorized.serviceAccountId) {
        return ErrorResponse.Unauthorized();
      }
      const rateLimitRes = await checkRateLimit(
        appContext,
        authorized,
        "usage_query",
      );
      if (rateLimitRes) return rateLimitRes;

      const url = new URL(ctx.request.url);
      const _organizationId = url.searchParams.get("organizationId");
      const _worldId = url.searchParams.get("worldId");

      if (authorized.serviceAccountId) {
        const usageService = new UsageService(appContext.database);
        usageService.meter({
          service_account_id: authorized.serviceAccountId,
          feature_id: "usage_query",
          quantity: 1,
        });
      }

      return Response.json([]);
    },
  );
};
