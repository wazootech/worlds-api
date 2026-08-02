import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { registerHealthRoutes } from "./routes/health";
import { registerWorldsRoutes } from "./routes/worlds";
import { registerImportExportRoutes } from "./routes/import-export";
import { registerSearchRoutes } from "./routes/search";
import { registerSparqlRoutes } from "./routes/sparql";
import { registerApiKeysRoutes } from "./routes/api-keys";

const app = new OpenAPIHono<{ Bindings: Env }>();

app.use("*", cors());

app.openAPIRegistry.registerComponent("securitySchemes", "bearerWorldsToken", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "wzw",
  description: "Worlds API data-plane token.",
});

app.onError((err, c) => {
  console.error(err);
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Headers", "*");
  c.header("Access-Control-Allow-Methods", "*");
  const message = err instanceof Error ? err.message : String(err);
  if (
    err instanceof SyntaxError ||
    (typeof message === "string" &&
      (message.includes("Unexpected end of JSON") ||
        message.includes("Malformed JSON in request body")))
  ) {
    return c.json(
      {
        error: {
          code: "INVALID_ARGUMENT",
          message: "Invalid JSON body",
        },
      },
      400,
    );
  }
  return c.json(
    {
      error: {
        code: "INTERNAL",
        message: err instanceof Error ? err.message : "Internal server error",
      },
    },
    500,
  );
});

app.notFound((c) => {
  c.header("Access-Control-Allow-Origin", "*");
  return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
});

registerHealthRoutes(app);
registerWorldsRoutes(app);
registerImportExportRoutes(app);
registerSearchRoutes(app);
registerSparqlRoutes(app);
registerApiKeysRoutes(app);

app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: {
    title: "Worlds API",
    version: "0.1.0",
    description:
      "Data-plane API for Wazoo Worlds — search, SPARQL, import, export, and World lifecycle.",
  },
  servers: [{ url: "https://worlds-api.wazoo.dev", description: "Worlds API" }],
  security: [{ bearerWorldsToken: [] }],
});

export default app;
