import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../env";
import { registerReindex } from "./reindex/handler";

export function registerReindexRoutes(app: OpenAPIHono<{ Bindings: Env }>) {
  registerReindex(app);
}
