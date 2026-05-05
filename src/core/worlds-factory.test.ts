import { assertEquals } from "@std/assert";
import { createWorldsWithLibsql } from "./worlds-factory.ts";
import { Worlds } from "./worlds.ts";

Deno.test("WorldsFactory: createWorldsWithLibsql produces persistent indexed storage", async () => {
  const factoryResult = createWorldsWithLibsql({
    url: "file::memory:",
  });

  const worlds = new Worlds(factoryResult, "test-key", [
    "world:*:*",
    "namespace:*:*",
  ]);

  const ref = { namespace: "ns", id: "persistent" };
  await worlds.createWorld({
    namespace: ref.namespace,
    id: ref.id,
    displayName: "Persistent World",
  });

  // Import some data
  await worlds.import({
    source: "ns/persistent",
    data: `<https://example.org/s> <https://example.org/p> "persistent data" .`,
    contentType: "application/n-quads",
  });

  // 1. Check quads are in storage (Persistence)
  const quads = await factoryResult.quadStorageManager.getQuadStorage(ref);
  const foundQuads = await quads.findQuads([]);
  assertEquals(foundQuads.length, 1);
  assertEquals(foundQuads[0].object, "persistent data");

  // 2. Check search works (Indexing)
  const searchResult = await worlds.search({
    query: "persistent",
    source: ref,
  });
  assertEquals(searchResult.results?.length, 1);
  assertEquals(searchResult.results?.[0].object, "persistent data");

  // 3. Check cascading delete works
  await worlds.deleteWorld({ source: ref });

  // Verify world metadata is gone
  const world = await factoryResult.worldStorage.getWorld(ref);
  assertEquals(world, null);

  // Verify quads are gone (via cascades)
  // We don't use quadStorageManager.getQuadStorage here because it re-initializes the state!
  interface LibsqlProxy { client: { execute: (q: { sql: string, args: unknown[] }) => Promise<{ rows: unknown[] }> } }
  const quadCheck = await (factoryResult.chunkIndexManager as unknown as LibsqlProxy).client
    .execute({
      sql: "SELECT * FROM quads WHERE world_namespace = ? AND world_id = ?",
      args: ["ns", "persistent"],
    });
  assertEquals(quadCheck.rows.length, 0);

  // Verify chunks are gone (via cascades)
  const chunkCheck = await (factoryResult.chunkIndexManager as unknown as LibsqlProxy).client
    .execute({
      sql: "SELECT * FROM chunks WHERE world_namespace = ? AND world_id = ?",
      args: ["ns", "persistent"],
    });
  assertEquals(chunkCheck.rows.length, 0);

  // Verify state is gone (via explicit delete in manager)
  const state = await factoryResult.chunkIndexManager.getIndexState(ref);
  assertEquals(state, null);
});
