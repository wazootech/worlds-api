import type { Router } from "@fartlabs/rt";
import type { ServerContext } from "#/context.ts";
import { createServer, createServerContext } from "#/server.ts";

const serverContext: ServerContext = await createServerContext({
  env: {
    ADMIN_API_KEY: Deno.env.get("ADMIN_API_KEY")!,
    LIBSQL_URL: Deno.env.get("LIBSQL_URL")!,
    LIBSQL_AUTH_TOKEN: Deno.env.get("LIBSQL_AUTH_TOKEN")!,
    TURSO_API_TOKEN: Deno.env.get("TURSO_API_TOKEN"),
    TURSO_ORG: Deno.env.get("TURSO_ORG"),
    GOOGLE_API_KEY: Deno.env.get("GOOGLE_API_KEY")!,
    GOOGLE_EMBEDDINGS_MODEL: Deno.env.get("GOOGLE_EMBEDDINGS_MODEL")!,
    WORLDS_BASE_DIR: Deno.env.get("WORLDS_BASE_DIR"),
  },
});

const app: Router = await createServer(serverContext);

export default {
  fetch: (request: Request) => app.fetch(request),
} as Deno.ServeDefaultExport;
