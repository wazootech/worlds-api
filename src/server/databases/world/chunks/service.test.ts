import { assertEquals } from "@std/assert";

import { createTestContext, createTestOrganization } from "#/server/testing.ts";
import { TriplesService } from "../triples/service.ts";
import { WorldsService } from "#/server/databases/core/worlds/service.ts";
import { ChunksService } from "./service.ts";

Deno.test("ChunksService", async (t) => {
  const testContext = await createTestContext();
  const worldsService = new WorldsService(testContext.database);
  const chunksService = new ChunksService(testContext, worldsService);

  const { id: organizationId } = await createTestOrganization(testContext, {
    plan: "free",
  });

  const worldId = crypto.randomUUID();
  const now = Date.now();
  await worldsService.insert({
    id: worldId,
    organization_id: organizationId,
    label: "Test World",
    description: "Test Description",
    db_hostname: null,
    db_token: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });
  await testContext.databaseManager!.create(worldId);

  const worldManaged = await testContext.databaseManager!.get(worldId);
  const triplesService = new TriplesService(worldManaged.database);

  await t.step("search with no results", async () => {
    const results = await chunksService.search({
      query: "nonexistent",
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

    const results = await chunksService.search({
      query: "apples",
      worldIds: [worldId],
      organizationId,
    });

    assertEquals(results.length, 1);
    assertEquals(results[0].subject, "s");
    assertEquals(results[0].object, "o");
  });
});
