import { createRpcApp } from "#/rpc/mod.ts";
import { createWorldsWithLibsql } from "#/core/worlds-factory.ts";

const { worldStorage, quadStorageManager } = createWorldsWithLibsql();

const app = createRpcApp({
  worldStorage,
  quadStorageManager,
});

export default {
  fetch: (req: Request) => app.fetch(req),
} satisfies Deno.ServeDefaultExport;
