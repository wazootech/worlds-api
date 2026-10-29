import { createRoute, z } from "@hono/zod-openapi";

export const VectorCleanupSchema = z
  .object({
    worlds: z.number().int().nonnegative().openapi({
      description: "Worlds of the namespace whose vectors were cleaned.",
    }),
    attempted: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    incomplete: z.boolean().openapi({
      description:
        "True when vectors remain (a failure, or more than one request can remove). Calling the endpoint again is safe and continues; the purge sweep retries too.",
    }),
    errors: z.array(z.string()),
  })
  .openapi("VectorCleanupReport");

export const namespaceDeleteRoute = createRoute({
  method: "post",
  path: "/admin/namespaces/{namespace}/delete",
  tags: ["Admin"],
  operationId: "deleteNamespaceWorlds",
  summary: "Mark all worlds for a namespace deleted (account deletion)",
  description:
    "Admin-only. Soft-deletes all worlds in a namespace and revokes all API keys for that namespace. Used for account deletion workflows.",
  "x-mint": { metadata: { title: "Delete namespace worlds" } },
  security: [{ bearerWorldsToken: [] }],
  request: {
    params: z.object({
      namespace: z.string().openapi({
        param: { name: "namespace", in: "path", required: true },
      }),
    }),
  },
  responses: {
    200: {
      description: "Delete result",
      content: {
        "application/json": {
          schema: z.object({
            deletedWorlds: z.number().int(),
            revokedKeys: z.number().int(),
            vectorCleanup: VectorCleanupSchema.optional(),
          }),
        },
      },
    },
    403: {
      description: "Forbidden",
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

export const purgeRoute = createRoute({
  method: "post",
  path: "/admin/purge",
  tags: ["Admin"],
  operationId: "purgeWorlds",
  summary: "Run purge sweep on demand",
  description:
    "Admin-only. Triggers the purge sweep to permanently delete all worlds whose 30-day grace period has expired. Normally runs on a schedule; this endpoint forces an immediate sweep.",
  "x-mint": { metadata: { title: "Run purge sweep on demand" } },
  security: [{ bearerWorldsToken: [] }],
  responses: {
    200: {
      description: "Purge sweep result",
      content: {
        "application/json": {
          schema: z.object({
            purged: z.number().int(),
            failed: z.number().int(),
          }),
        },
      },
    },
    403: {
      description: "Forbidden",
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
