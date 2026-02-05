import { Router } from "@fartlabs/rt";
import { authorizeRequest } from "#/server/middleware/auth.ts";
import { checkRateLimit } from "#/server/middleware/rate-limit.ts";
import type { AppContext } from "#/server/app-context.ts";
import { ErrorResponse } from "#/server/errors.ts";
import { MetricsService } from "#/server/databases/core/metrics/service.ts";
import { selectOrganizationById } from "#/server/databases/core/organizations/queries.sql.ts";

export default (appContext: AppContext) => {
  return new Router().get(
    "/v1/organizations/:organization/metrics",
    async (ctx) => {
      const organizationId = ctx.params?.pathname.groups.organization;
      if (!organizationId) {
        return ErrorResponse.BadRequest("Organization ID required");
      }

      const authorized = await authorizeRequest(appContext, ctx.request);
      if (!authorized.admin && !authorized.serviceAccountId) {
        return ErrorResponse.Unauthorized();
      }

      // Check access: Admin can acccess any, Service Account only its own org (via relationship)
      // Actually service account has organizationId in authorized object
      if (!authorized.admin) {
        if (authorized.organizationId !== organizationId) {
          return ErrorResponse.Forbidden();
        }
      }

      // Verify organization exists
      const orgResult = await appContext.database.execute({
        sql: selectOrganizationById,
        args: [organizationId],
      });
      if (orgResult.rows.length === 0) {
        return ErrorResponse.NotFound("Organization not found");
      }

      const rateLimitRes = await checkRateLimit(
        appContext,
        authorized,
        "metrics_query",
      );
      if (rateLimitRes) return rateLimitRes;

      if (authorized.serviceAccountId) {
        const metricsService = new MetricsService(appContext.database);
        metricsService.record({
          service_account_id: authorized.serviceAccountId,
          feature_id: "metrics_query",
          quantity: 1,
        });
      }

      // TODO: Implement actual metrics retrieval logic using MetricsService
      // For now, return empty list as in original file
      return Response.json([]);
    },
  );
};
