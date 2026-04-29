import { mainApp } from "#/api/server/mod.ts";

Deno.serve((req) => mainApp.fetch(req));
