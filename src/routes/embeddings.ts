import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../env";
import { registerEmbeddingHandlers } from "./embeddings/handlers";

export function registerEmbeddingRoutes(app: OpenAPIHono<{ Bindings: Env }>) {
  registerEmbeddingHandlers(app);
}
