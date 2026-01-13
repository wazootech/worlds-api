import { Router } from "@fartlabs/rt";
import { authorizeRequest } from "#/server/middleware/auth.ts";
import type { AppContext } from "#/server/app-context.ts";

export default (appContext: AppContext) => {
  return new Router().get(
    "/v1/worlds/:world/search",
    async (ctx) => {
      const worldId = ctx.params?.pathname.groups.world;
      if (!worldId) {
        return new Response("World ID required", { status: 400 });
      }

      const authorized = await authorizeRequest(appContext, ctx.request);
      if (!authorized.account && !authorized.admin) {
        return new Response("Unauthorized", { status: 401 });
      }

      const url = new URL(ctx.request.url);
      const query = url.searchParams.get("q");
      if (!query) {
        return new Response("Query required", { status: 400 });
      }

      // TODO: Implement actual search logic
      return Response.json({
        results: [],
        query,
      });
    },
  );
};
