import { createRoute, z } from "@hono/zod-openapi";
import {
  worldIdParam,
  WorldResourceSchema,
  worldsListQuery,
} from "../../lib/schemas";

export const listRoute = createRoute({
  method: "get",
  path: "/worlds",
  tags: ["Worlds"],
  operationId: "listWorlds",
  summary: "List worlds",
  description:
    "List all worlds accessible to the authenticated token. Admin tokens see all worlds; namespace-scoped tokens see only their namespace's worlds.",
  "x-mint": { metadata: { title: "List worlds" } },
  security: [{ bearerWorldsToken: [] }],
  request: { query: worldsListQuery },
  responses: {
    200: {
      description: "World list",
      content: {
        "application/json": {
          schema: z.object({ worlds: z.array(WorldResourceSchema) }),
        },
      },
    },
  },
});

export const getRoute = createRoute({
  method: "get",
  path: "/worlds/{worldId}",
  tags: ["Worlds"],
  operationId: "getWorld",
  summary: "Get world",
  description:
    "Retrieve a single world by its unique identifier. Returns the full WorldResource including state, storage backend, and search configuration.",
  "x-mint": { metadata: { title: "Get world" } },
  security: [{ bearerWorldsToken: [] }],
  request: { params: worldIdParam },
  responses: {
    200: {
      description: "World",
      content: {
        "application/json": { schema: WorldResourceSchema },
      },
    },
    404: {
      description: "Not found",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
  },
});
