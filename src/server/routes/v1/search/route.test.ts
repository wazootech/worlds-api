import { assertEquals } from "@std/assert";
import route from "./route.ts";
import sparqlRoute from "../worlds/sparql/route.ts";
import { insertWorld } from "#/server/db/resources/worlds/queries.sql.ts";
import { organizationsAdd } from "#/server/db/resources/organizations/queries.sql.ts";
import { createTestContext } from "#/server/testing.ts";
import type { AppContext } from "#/server/app-context.ts";

Deno.test("Search API - End-to-End via SPARQL", async (t) => {
  const testContext = await createTestContext();
  const appContext = testContext as unknown as AppContext;
  const adminHandler = route(appContext);
  const sparqlHandler = sparqlRoute(appContext);
  const adminApiKey = testContext.admin!.apiKey;

  await t.step("SPARQL Insert -> Search Flow", async () => {
    try {
      const orgId = crypto.randomUUID();
      // Create organization
      await testContext.libsqlClient.execute({
        sql: organizationsAdd,
        args: [
          orgId,
          "Test Org",
          "Desc",
          "free",
          "key",
          Date.now(),
          Date.now(),
          null,
        ],
      });

      const worldId = crypto.randomUUID();
      // Create world
      await testContext.libsqlClient.execute({
        sql: insertWorld,
        args: [
          worldId,
          orgId,
          "World",
          "Desc",
          null,
          null,
          null,
          Date.now(),
          Date.now(),
          null,
        ],
      });

      // 1. Execute SPARQL Update to insert data
      const sparqlUrl = `http://localhost/v1/worlds/${worldId}/sparql`;
      const updateQuery = `
        INSERT DATA {
          <http://example.org/s1> <http://example.org/p1> "The quick brown fox" .
        }
      `;

      const sparqlResp = await sparqlHandler.fetch(
        new Request(sparqlUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${adminApiKey}`,
            "Content-Type": "application/sparql-update",
          },
          body: updateQuery,
        }),
      );

      assertEquals(sparqlResp.status, 204);

      // 2. Search for the inserted data
      const searchUrl =
        `http://localhost/v1/search?q=fox&organizationId=${orgId}`;
      const searchResp = await adminHandler.fetch(
        new Request(searchUrl, {
          headers: { "Authorization": `Bearer ${adminApiKey}` },
        }),
      );

      assertEquals(searchResp.status, 200);
      const results = await searchResp.json();

      assertEquals(results.length, 1);
      assertEquals(results[0].subject, "http://example.org/s1");
      assertEquals(results[0].object, "The quick brown fox");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  await t.step("SPARQL Delete -> Cascade Flow", async () => {
    // 1. Verify chunk exists (from previous step)
    const worldId =
      (await testContext.libsqlClient.execute("SELECT id FROM worlds")).rows[0]
        .id as string;
    const sparqlHandler = sparqlRoute(appContext);
    const adminApiKey = testContext.admin!.apiKey;

    // Verify chunk count > 0
    const chunksBefore = await testContext.libsqlManager!.get(worldId).then(
      (c) => c.execute("SELECT count(*) as count FROM chunks"),
    );
    const countBefore = chunksBefore.rows[0].count as number;
    assertEquals(countBefore > 0, true, "Chunks should exist before delete");

    // 2. SPARQL Delete
    const sparqlUrl = `http://localhost/v1/worlds/${worldId}/sparql`;
    const deleteQuery = `
      DELETE DATA {
        <http://example.org/s1> <http://example.org/p1> "The quick brown fox" .
      }
    `;

    const sparqlResp = await sparqlHandler.fetch(
      new Request(sparqlUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${adminApiKey}`,
          "Content-Type": "application/sparql-update",
        },
        body: deleteQuery,
      }),
    );
    assertEquals(sparqlResp.status, 204);

    // 3. Verify triple and chunk gone
    const triplesAfter = await testContext.libsqlManager!.get(worldId).then(
      (c) => c.execute("SELECT count(*) as count FROM triples"),
    );
    assertEquals(triplesAfter.rows[0].count, 0, "Triples should be empty");

    const chunksAfter = await testContext.libsqlManager!.get(worldId).then(
      (c) => c.execute("SELECT count(*) as count FROM chunks"),
    );
    assertEquals(
      chunksAfter.rows[0].count,
      0,
      "Chunks should be empty (cascade)",
    );
  });
});
