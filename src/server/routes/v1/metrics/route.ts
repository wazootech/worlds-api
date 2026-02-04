import { Router } from "@fartlabs/rt";
import { authorizeRequest } from "#/server/middleware/auth.ts";
import { checkRateLimit } from "#/server/middleware/rate-limit-policy.ts";
import type { AppContext } from "#/server/app-context.ts";
import { ErrorResponse } from "#/server/errors.ts";
import { MetricsService } from "#/server/databases/core/metrics/service.ts";

/**
 * GET /v1/metrics - Query usage/metering data.
 * Optional query params: organizationId, worldId to scope results.
 * Metrics queries are not yet implemented; returns empty array.
 */
export default (appContext: AppContext) => {
  return new Router().get(
    "/v1/metrics",
    async (ctx) => {
      const authorized = await authorizeRequest(appContext, ctx.request);
      if (!authorized.admin && !authorized.serviceAccountId) {
        return ErrorResponse.Unauthorized();
      }
      const rateLimitRes = await checkRateLimit(
        appContext,
        authorized,
        "metrics_query",
      );
      if (rateLimitRes) return rateLimitRes;

      const url = new URL(ctx.request.url);
      const _organizationId = url.searchParams.get("organizationId");
      const _worldId = url.searchParams.get("worldId");

      if (authorized.serviceAccountId) {
        const metricsService = new MetricsService(appContext.database);
        metricsService.record({
          service_account_id: authorized.serviceAccountId,
          feature_id: "metrics_query",
          quantity: 1,
        });
      }

      return Response.json([]);
    },
  );
};
