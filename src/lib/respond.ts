import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function respond(
  c: Context,
  data: unknown,
  status?: ContentfulStatusCode,
) {
  return c.json(data, status as any) as any;
}
