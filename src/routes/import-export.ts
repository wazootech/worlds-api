import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../env";
import { registerExport } from "./import-export/export-handler";
import { registerImport } from "./import-export/import-handler";

export { RDF_IMPORT_CONTENT_TYPES } from "./import-export/constants";

export function registerImportExportRoutes(
  app: OpenAPIHono<{ Bindings: Env }>,
) {
  registerImport(app);
  registerExport(app);
}
