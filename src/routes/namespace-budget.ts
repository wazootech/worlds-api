import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../env";
import { authorize } from "../lib/auth";
import { getDb, queryOne } from "../lib/db";
import { respond } from "../lib/respond";
import { ErrorResponseSchema } from "../lib/schemas";
import {
  namespaceWriteBudget,
  rowWriteBudget,
  rowsWrittenToday,
  setNamespaceWriteBudget,
} from "../lib/write-budget";

const namespaceParam = z.object({
  namespace: z
    .string()
    .min(1)
    .max(256)
    .openapi({
      param: { name: "namespace", in: "path", required: true },
    }),
});

const NamespaceWriteBudgetSchema = z
  .object({
    namespace: z.string(),
    dailyRows: z.number().int().positive().nullable().openapi({
      description:
        "The override set for this namespace, or null when it uses the default.",
    }),
    defaultDailyRows: z.number().int().positive().nullable().openapi({
      description:
        "The deployment default (NAMESPACE_DAILY_ROW_WRITE_BUDGET), or null when none is set.",
    }),
    effectiveDailyRows: z.number().int().positive().nullable().openapi({
      description:
        "The budget that applies now: the override, else the default. Null means no budget.",
    }),
    rowsWrittenToday: z.number().int().nonnegative().openapi({
      description:
        "D1 rows the namespace has written today (UTC), index writes included.",
    }),
    day: z.string().openapi({ description: "The UTC day, YYYY-MM-DD." }),
  })
  .openapi("NamespaceWriteBudget");

const SetNamespaceWriteBudgetSchema = z
  .object({
    dailyRows: z.number().int().min(1).max(1_000_000_000).openapi({
      description:
        "Daily D1 rows the namespace may write (UTC day). Each stored quad costs about 9 rows, and about 94 per asserted quad with inference on.",
    }),
  })
  .openapi("SetNamespaceWriteBudgetRequest");

const forbiddenResponse = {
  description: "Admin key required",
  content: { "application/json": { schema: ErrorResponseSchema } },
};

async function describeBudget(env: Env, namespace: string) {
  const override = await queryOne<{ daily_rows: number }>(
    getDb(env),
    "SELECT daily_rows FROM namespace_write_budget WHERE namespace = ?",
    [namespace],
  );
  return {
    namespace,
    dailyRows: override ? Number(override.daily_rows) : null,
    defaultDailyRows: rowWriteBudget(env),
    effectiveDailyRows: await namespaceWriteBudget(env, namespace),
    rowsWrittenToday: await rowsWrittenToday(env, namespace),
    day: new Date().toISOString().slice(0, 10),
  };
}

const forbidden = () => ({
  error: { code: "FORBIDDEN", message: "Admin key required" },
});

export function registerNamespaceBudgetRoutes(
  app: OpenAPIHono<{ Bindings: Env }>,
) {
  app.openapi(
    createRoute({
      method: "get",
      path: "/admin/namespaces/{namespace}/write-budget",
      tags: ["Admin"],
      operationId: "getNamespaceWriteBudget",
      summary: "Get a namespace's daily write budget and today's usage",
      description:
        "Admin-only. Returns the budget that applies to the namespace (its override, else the deployment default) and the D1 rows it has written today. The platform reads this to show usage against a plan.",
      "x-mint": { metadata: { title: "Get namespace write budget" } },
      security: [{ bearerWorldsToken: [] }],
      request: { params: namespaceParam },
      responses: {
        200: {
          description: "The namespace's budget and usage",
          content: {
            "application/json": { schema: NamespaceWriteBudgetSchema },
          },
        },
        403: forbiddenResponse,
      },
    }),
    async (c) => {
      const env = c.env as unknown as Env;
      const auth = await authorize(c.req.raw, env);
      if (!auth.admin) return respond(c, forbidden(), 403);
      return respond(c, await describeBudget(env, c.req.param("namespace")));
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/admin/namespaces/{namespace}/write-budget",
      tags: ["Admin"],
      operationId: "setNamespaceWriteBudget",
      summary: "Set a namespace's daily write budget",
      description:
        "Admin-only. Sets how many D1 rows the namespace may write per UTC day, overriding the deployment default. Writes (SPARQL updates, import, inference back-fill) are refused with 429 WRITE_BUDGET_EXCEEDED once the namespace has used it; reads are never refused. Used by the platform to apply a customer's plan. Takes effect within about 30 seconds across the fleet.",
      "x-mint": { metadata: { title: "Set namespace write budget" } },
      security: [{ bearerWorldsToken: [] }],
      request: {
        params: namespaceParam,
        body: {
          content: {
            "application/json": { schema: SetNamespaceWriteBudgetSchema },
          },
        },
      },
      responses: {
        200: {
          description: "The budget now in effect",
          content: {
            "application/json": { schema: NamespaceWriteBudgetSchema },
          },
        },
        403: forbiddenResponse,
      },
    }),
    async (c) => {
      const env = c.env as unknown as Env;
      const auth = await authorize(c.req.raw, env);
      if (!auth.admin) return respond(c, forbidden(), 403);
      const namespace = c.req.param("namespace");
      const { dailyRows } = c.req.valid("json");
      await setNamespaceWriteBudget(env, namespace, dailyRows);
      return respond(c, await describeBudget(env, namespace));
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/admin/namespaces/{namespace}/write-budget",
      tags: ["Admin"],
      operationId: "clearNamespaceWriteBudget",
      summary: "Clear a namespace's daily write budget override",
      description:
        "Admin-only. Removes the namespace's override so it uses the deployment default again. Idempotent.",
      "x-mint": { metadata: { title: "Clear namespace write budget" } },
      security: [{ bearerWorldsToken: [] }],
      request: { params: namespaceParam },
      responses: {
        200: {
          description: "The budget now in effect",
          content: {
            "application/json": { schema: NamespaceWriteBudgetSchema },
          },
        },
        403: forbiddenResponse,
      },
    }),
    async (c) => {
      const env = c.env as unknown as Env;
      const auth = await authorize(c.req.raw, env);
      if (!auth.admin) return respond(c, forbidden(), 403);
      const namespace = c.req.param("namespace");
      await setNamespaceWriteBudget(env, namespace, null);
      return respond(c, await describeBudget(env, namespace));
    },
  );
}
