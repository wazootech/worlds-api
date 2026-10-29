import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function respond(
  c: Context,
  data: unknown,
  status?: ContentfulStatusCode,
) {
  // The `any` return is load-bearing: OpenAPI route handlers are typed against
  // each route's response union, and several also return raw `Response`s
  // (streams, 204s, aborts). `any` absorbs both. Narrowing it means typing
  // every handler's responses, which is tracked separately.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return c.json(data, status as ContentfulStatusCode) as any;
}
