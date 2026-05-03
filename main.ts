import { mainApp } from "#/api/server/mod.ts";

export default {
  fetch: (req: Request) => mainApp.fetch(req),
} satisfies Deno.ServeDefaultExport;
