import { z } from "@hono/zod-openapi";
import type { Env } from "../../env";
import { getDb, queryOne } from "../../lib/db";
import { ErrorResponseSchema } from "../../lib/schemas";
import {
  namespaceWriteBudget,
  rowWriteBudget,
  rowsWrittenToday,
} from "../../lib/write-budget";

export const namespaceParam = z.object({
  namespace: z
    .string()
    .min(1)
    .max(256)
    .openapi({
      param: { name: "namespace", in: "path", required: true },
    }),
});

export const NamespaceWriteBudgetSchema = z
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

export const SetNamespaceWriteBudgetSchema = z
  .object({
    dailyRows: z.number().int().min(1).max(1_000_000_000).openapi({
      description:
        "Daily D1 rows the namespace may write (UTC day). Each stored quad costs about 9 rows, and about 94 per asserted quad with inference on.",
    }),
  })
  .openapi("SetNamespaceWriteBudgetRequest");

export const forbiddenResponse = {
  description: "Admin key required",
  content: { "application/json": { schema: ErrorResponseSchema } },
};

export async function describeBudget(env: Env, namespace: string) {
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

export const forbidden = () => ({
  error: { code: "FORBIDDEN", message: "Admin key required" },
});
