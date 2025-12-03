import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

export const app = new OpenAPIHono();

app.openapi(
  createRoute({
    method: "get",
    path: "/graphs",
    responses: {
      200: {
        description: "List graphs of the authenticated user",
        content: {
          "application/json": {
            schema: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
              }),
            ),
          },
        },
      },
    },
  }),
  (ctx) => {
    return ctx.json([
      {
        id: "1",
        name: "Graph 1",
      },
    ]);
  },
);
