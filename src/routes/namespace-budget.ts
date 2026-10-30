import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../env";
import { authorize } from "../lib/auth";
import { respond } from "../lib/respond";
import { setNamespaceWriteBudget } from "../lib/write-budget";
import {
  clearBudgetRoute,
  getBudgetRoute,
  setBudgetRoute,
} from "./namespace-budget/routes";
import { describeBudget, forbidden } from "./namespace-budget/shared";

export function registerNamespaceBudgetRoutes(
  app: OpenAPIHono<{ Bindings: Env }>,
) {
  app.openapi(getBudgetRoute, async (c) => {
    const env = c.env as unknown as Env;
    const auth = await authorize(c.req.raw, env);
    if (!auth.admin) return respond(c, forbidden(), 403);
    return respond(c, await describeBudget(env, c.req.param("namespace")));
  });

  app.openapi(setBudgetRoute, async (c) => {
    const env = c.env as unknown as Env;
    const auth = await authorize(c.req.raw, env);
    if (!auth.admin) return respond(c, forbidden(), 403);
    const namespace = c.req.param("namespace");
    const { dailyRows } = c.req.valid("json");
    await setNamespaceWriteBudget(env, namespace, dailyRows);
    return respond(c, await describeBudget(env, namespace));
  });

  app.openapi(clearBudgetRoute, async (c) => {
    const env = c.env as unknown as Env;
    const auth = await authorize(c.req.raw, env);
    if (!auth.admin) return respond(c, forbidden(), 403);
    const namespace = c.req.param("namespace");
    await setNamespaceWriteBudget(env, namespace, null);
    return respond(c, await describeBudget(env, namespace));
  });
}
