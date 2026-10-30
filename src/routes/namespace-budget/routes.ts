import { createRoute } from "@hono/zod-openapi";
import {
  forbiddenResponse,
  namespaceParam,
  NamespaceWriteBudgetSchema,
  SetNamespaceWriteBudgetSchema,
} from "./shared";

export const getBudgetRoute = createRoute({
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
});

export const setBudgetRoute = createRoute({
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
});

export const clearBudgetRoute = createRoute({
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
});
