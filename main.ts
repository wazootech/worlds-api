import { createRpcApp } from "#/rpc/mod.ts";
import { createWorldsWithLibsql } from "#/core/worlds-factory.ts";

const {
  worldStorage,
  quadStorageManager,
  chunkIndexManager,
  embeddings,
} = createWorldsWithLibsql();

const app = createRpcApp({
  worldStorage,
  quadStorageManager,
  chunkIndexManager,
  embeddings,
});

export default {
  fetch: (req: Request) => app.fetch(req),
} satisfies Deno.ServeDefaultExport;
