import { assertEquals } from "@std/assert";
import { insertWorld } from "#/server/databases/core/worlds/queries.sql.ts";
import { createTestContext, createTestOrganization } from "#/server/testing.ts";
import { TriplesService } from "../triples/service.ts";

Deno.test("ChunksService", async (t) => {
  const testContext = await createTestContext();
  const { id: organizationId } = await createTestOrganization(testContext);

  const worldId = crypto.randomUUID();
  const now = Date.now();
  await testContext.database.execute({
    sql: insertWorld,
    args: [
      worldId,
      organizationId,
      "Test World",
      "Test Description",
      null, // db_hostname
      null, // db_auth_token
      now,
      now,
      null,
    ],
  });
  await testContext.databaseManager!.create(worldId);

  const service = testContext.chunksService;
  const worldManaged = await testContext.databaseManager!.get(worldId);
  const triplesService = new TriplesService(worldManaged.database);

  await t.step("search with no results", async () => {
    const results = await service.search({
      query: "test",
      worldIds: [worldId],
      organizationId,
    });
    assertEquals(results.length, 0);
  });

  await t.step("search with results", async () => {
    const tripleId = "t1";
    await triplesService.upsert({
      id: tripleId,
      subject: "s",
      predicate: "p",
      object: "o",
      vector: null,
    });

    await worldManaged.database.execute({
      sql:
        "INSERT INTO chunks (id, triple_id, subject, predicate, text, vector) VALUES (?, ?, ?, ?, ?, vector32(?))",
      args: [
        "c1",
        tripleId,
        "s",
        "p",
        "This is a test chunk about apples.",
        new Uint8Array(new Float32Array(1536).fill(0).buffer),
      ],
    });

    const results = await service.search({
      query: "apples",
      worldIds: [worldId],
      organizationId,
    });

    assertEquals(results.length, 1);
    assertEquals(results[0].subject, "s");
    assertEquals(results[0].object, "o");
  });
});
