import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { isOriginAllowed } from "./lib/abuse";
import {
  flushUsageMiddleware,
  onAppError,
  onNotFound,
  rateLimitMiddleware,
  schemaInitMiddleware,
} from "./lib/app-middleware";
import { registerHealthRoutes } from "./routes/health";
import { registerWorldsRoutes } from "./routes/worlds";
import { registerImportExportRoutes } from "./routes/import-export";
import { registerSearchRoutes } from "./routes/search";
import { registerSparqlRoutes } from "./routes/sparql";
import { registerApiKeysRoutes } from "./routes/api-keys";
import { registerEmbeddingRoutes } from "./routes/embeddings";
import { registerReindexRoutes } from "./routes/reindex";
import { registerInferRoutes } from "./routes/infer";
import { registerNamespaceBudgetRoutes } from "./routes/namespace-budget";

const app = new OpenAPIHono<{ Bindings: Env }>();

// CORS is origin-restricted (default: console origins + preview workers),
// never "*". Requests without an Origin header are unaffected.
app.use(
  "*",
  cors({
    origin: (origin, c) =>
      isOriginAllowed(origin, c.env as unknown as Env) ? origin : null,
  }),
);

app.use("*", rateLimitMiddleware);

app.openAPIRegistry.registerComponent("securitySchemes", "bearerWorldsToken", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "wzw",
  description: "Worlds API data-plane token.",
});

app.onError(onAppError);

app.notFound(onNotFound);

app.use("*", schemaInitMiddleware);

app.use("*", flushUsageMiddleware);

registerHealthRoutes(app);
registerWorldsRoutes(app);
registerImportExportRoutes(app);
registerSearchRoutes(app);
registerSparqlRoutes(app);
registerApiKeysRoutes(app);
registerReindexRoutes(app);
registerInferRoutes(app);
registerNamespaceBudgetRoutes(app);
registerEmbeddingRoutes(app);

/**
 * openApiDocOptions is the OpenAPI document configuration. It is the single
 * source of truth for the served spec (GET /openapi.json) and the committed
 * snapshot in openapi/openapi.json, so the two cannot drift apart.
 */
export const openApiDocOptions = {
  openapi: "3.0.0",
  info: {
    title: "Worlds API",
    version: "0.1.0",
    description:
      "Data-plane API for Wazoo Worlds — search, SPARQL, import, export, and World lifecycle.",
  },
  servers: [{ url: "https://data.wazoo.dev", description: "Worlds API" }],
  security: [{ bearerWorldsToken: [] }],
};

app.doc("/openapi.json", openApiDocOptions);

export default app;
