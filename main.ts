import { createRpcApp } from "#/rpc/mod.ts";
import { createWorldsWithLibsql } from "#/core/worlds-factory.ts";

const app = createRpcApp({
  worlds: createWorldsWithLibsql(),
});

export default {
  fetch: (req: Request) => app.fetch(req),
} satisfies Deno.ServeDefaultExport;
