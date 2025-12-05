import type { MiddlewareHandler } from "hono";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { OxigraphService } from "#/oxigraph/oxigraph-service.ts";

export interface OxigraphServiceEnv {
  Variables: {
    oxigraphService: OxigraphService;
  };
}

export function withOxigraphService(
  oxigraphService: OxigraphService,
): MiddlewareHandler<OxigraphServiceEnv> {
  return (ctx, next) => {
    ctx.set("oxigraphService", oxigraphService);
    return next();
  };
}

export const app = new OpenAPIHono<OxigraphServiceEnv>();

export const storeSchema = z.object({
  id: z.string(),
}).openapi("Store");

export const getStoreParamsSchema = z.object({
  store: z.string(),
}).openapi("GetStoreParams");

// WIP: https://github.com/honojs/middleware/tree/main/packages/zod-openapi#readme

app.openapi(
  createRoute({
    method: "get",
    path: "/stores/{store}",
    request: {
      params: getStoreParamsSchema,
    },
    responses: {
      200: {
        description: "Get a store",
        content: {
          "application/json": {
            schema: storeSchema,
          },
          "application/rdf+xml": {
            schema: z.string(),
          },
        },
      },
      404: {
        description: "Store not found",
      },
    },
  }),
  async (ctx) => {
    const storeId = ctx.req.param("store");
    const store = await ctx.var.oxigraphService.getStore(storeId);
    if (!store) {
      return ctx.notFound();
    }

    return ctx.json({ id: storeId });
  },
);
