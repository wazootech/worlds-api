import { assertEquals } from "@std/assert";
import route from "./route.ts";
import { insertWorld } from "#/server/db/resources/worlds/queries.sql.ts";
import { organizationsAdd } from "#/server/db/resources/organizations/queries.sql.ts";
import { createTestContext } from "#/server/testing.ts";
import type { AppContext } from "#/server/app-context.ts";

Deno.test("Search API - End-to-End", async (t) => {
  const testContext = await createTestContext();
  const adminHandler = route(testContext as unknown as AppContext);
  const adminApiKey = testContext.admin!.apiKey;

  await t.step("GET /v1/search - Full Flow", async () => {
    try {
      const orgId = crypto.randomUUID();
      // Create organization first (for FK)
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

      const worldClient = await testContext.libsqlManager!.get(worldId);

      const factId = "01JK4W8R6H9X8V9T2M1K9S4B7R";
      await worldClient.execute({
        sql:
          `INSERT INTO facts (id, item_id, property, value, vector) VALUES (?, ?, ?, ?, vector32(?))`,
        args: [
          factId,
          "s1",
          "p1",
          "The quick brown fox",
          new Uint8Array(new Float32Array(new Array(1536).fill(0)).buffer),
        ],
      });

      const url = `http://localhost/v1/search?q=fox&organizationId=${orgId}`;
      const resp = await adminHandler.fetch(
        new Request(url, {
          headers: { "Authorization": `Bearer ${adminApiKey}` },
        }),
      );

      assertEquals(resp.status, 200);
      const results = await resp.json();
      assertEquals(results.length, 1);
      assertEquals(results[0].itemId, "s1");
      assertEquals(results[0].value, "The quick brown fox");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  await t.step("GET /v1/search - Filtering by Subjects", async () => {
    // Reuse adminHandler and adminApiKey
    const orgId = crypto.randomUUID();
    await testContext.libsqlClient.execute({
      sql: organizationsAdd,
      args: [
        orgId,
        "Subj Org",
        "Desc",
        "free",
        "key",
        Date.now(),
        Date.now(),
        null,
      ],
    });

    const worldId = crypto.randomUUID();
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

    const worldClient = await testContext.libsqlManager!.get(worldId);
    await worldClient.execute({
      sql:
        `INSERT INTO facts (id, item_id, property, value, vector) VALUES (?, ?, ?, ?, vector32(?)), (?, ?, ?, ?, vector32(?))`,
      args: [
        "fact1",
        "s1",
        "p1",
        "Match",
        new Uint8Array(new Float32Array(new Array(1536).fill(0)).buffer),
        "fact2",
        "s2",
        "p1",
        "Ignore",
        new Uint8Array(new Float32Array(new Array(1536).fill(0)).buffer),
      ],
    });

    const url =
      `http://localhost/v1/search?q=Match&organizationId=${orgId}&s=s1`;
    const resp = await adminHandler.fetch(
      new Request(url, {
        headers: { "Authorization": `Bearer ${adminApiKey}` },
      }),
    );

    assertEquals(resp.status, 200);
    const results = await resp.json();
    assertEquals(results.length, 1);
    assertEquals(results[0].itemId, "s1");
  });
});
