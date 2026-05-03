import { rpcServer } from "#/api/server/mod.ts";

export default {
  fetch: (req: Request) => rpcServer.fetch(req),
} satisfies Deno.ServeDefaultExport;
