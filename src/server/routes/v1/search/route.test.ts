import { assertEquals } from "@std/assert";
// import { DataFactory } from "n3";
import route from "./route.ts";
import { createClient } from "@libsql/client";
// import { LibsqlSearchStoreManager } from "#/server/search/libsql.ts";
import { initializeDatabase } from "#/server/db/init.ts";
// import { insertWorld } from "#/server/db/resources/worlds/queries.sql.ts";

Deno.test("Search API - Top-Level Route (Disabled)", async (t) => {
  const client = createClient({ url: ":memory:" });
  await initializeDatabase(client);

  const embedder = {
    embed: (_: string) => Promise.resolve(new Array(1536).fill(0)),
    dimensions: 1536,
  };
  const appContext = {
    libsqlClient: client,
    embeddings: embedder,
    admin: { apiKey: "admin-key" },
  };
  const adminHandler = route(appContext);

  await t.step(
    "GET /v1/search returns 400 Bad Request if q is missing",
    async () => {
      const resp = await adminHandler.fetch(
        new Request("http://localhost/v1/search", {
          headers: { "Authorization": "Bearer admin-key" },
        }),
      );
      assertEquals(resp.status, 400);
    },
  );
});
/*
Deno.test("Search API - Top-Level Route", async (t) => {
...
});
*/
