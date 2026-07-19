import type { Context } from "hono";
import type { Env } from "../env";
import { getDb } from "../lib/db";

export async function health(c: Context) {
  const env = c.env as unknown as Env;
  try {
    const db = getDb(env);
    await db.execute("SELECT 1");
    return c.json({ status: "ok" });
  } catch (err) {
    return c.json(
      {
        status: "degraded",
        error: err instanceof Error ? err.message : "Unknown error",
      },
      503,
    );
  }
}
