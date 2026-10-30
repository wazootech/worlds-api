import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../env";
import { registerSparqlNoWorld, registerSparqlWorld } from "./sparql/handlers";

export function registerSparqlRoutes(app: OpenAPIHono<{ Bindings: Env }>) {
  registerSparqlNoWorld(app);
  registerSparqlWorld(app);
}
