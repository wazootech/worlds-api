import { assertEquals } from "@std/assert";
import { OramaChunkStorage } from "./orama.ts";

Deno.test("OramaChunkStorage: stores chunks with index state separately", async () => {
  const storage = await OramaChunkStorage.create();
  const world = { namespace: "ns", id: "w1" };

  await storage.markWorldIndexed({
    world,
    indexedAt: 123,
    embeddingDimensions: 384,
    embeddingModel: "placeholder",
  });

  assertEquals(await storage.getByWorld(world), []);
  assertEquals(await storage.getIndexState(world), {
    world,
    indexedAt: 123,
    embeddingDimensions: 384,
    embeddingModel: "placeholder",
  });
});

Deno.test("OramaChunkStorage: deletes chunks by fact id", async () => {
  const storage = await OramaChunkStorage.create();
  const world = { namespace: "ns", id: "w1" };

  await storage.setChunk({
    id: "chunk-1",
    factId: "fact-1",
    subject: "person:1",
    predicate: "name",
    text: "Ethan Gregory",
    vector: new Float32Array([1, 0]),
    world,
  });
  await storage.setChunk({
    id: "chunk-2",
    factId: "fact-2",
    subject: "person:2",
    predicate: "name",
    text: "Gregory",
    vector: new Float32Array([0, 1]),
    world,
  });

  await storage.deleteChunk(world, "fact-1");

  const remaining = await storage.getByWorld(world);
  assertEquals(remaining.length, 1);
  assertEquals(remaining[0].factId, "fact-2");
});

Deno.test("OramaChunkStorage: clearWorld removes rows and index state", async () => {
  const storage = await OramaChunkStorage.create();
  const world = { namespace: "ns", id: "w1" };

  await storage.setChunk({
    id: "chunk-1",
    factId: "fact-1",
    subject: "person:1",
    predicate: "name",
    text: "Ethan",
    vector: new Float32Array([1]),
    world,
  });
  await storage.setChunk({
    id: "chunk-2",
    factId: "fact-2",
    subject: "person:2",
    predicate: "name",
    text: "Gregory",
    vector: new Float32Array([1]),
    world,
  });
  await storage.markWorldIndexed({
    world,
    indexedAt: Date.now(),
    embeddingDimensions: 1,
  });

  await storage.clearWorld(world);

  assertEquals(await storage.getByWorld(world), []);
  assertEquals(await storage.getIndexState(world), null);
});

Deno.test("OramaChunkStorage: searches chunks with filters and ranking", async () => {
  const storage = await OramaChunkStorage.create();
  const world = { namespace: "ns", id: "w1" };

  await storage.setChunk({
    id: "chunk-1",
    factId: "fact-1",
    subject: "person:1",
    predicate: "name",
    text: "Ethan Gregory",
    vector: new Float32Array([1, 0]),
    world,
  });
  await storage.setChunk({
    id: "chunk-2",
    factId: "fact-2",
    subject: "person:2",
    predicate: "name",
    text: "Gregory",
    vector: new Float32Array([0, 1]),
    world,
  });

  const rows = await storage.search({
    worlds: [world],
    queryText: "ethan gregory",
    queryTerms: ["ethan", "gregory"],
    queryVector: new Float32Array([1, 0]),
  });

  assertEquals(rows.length, 2);
  assertEquals(rows[0].chunk.id, "chunk-1");
});

Deno.test("OramaChunkStorage: search respects world boundary", async () => {
  const storage = await OramaChunkStorage.create();
  const world1 = { namespace: "ns", id: "w1" };
  const world2 = { namespace: "ns", id: "w2" };

  await storage.setChunk({
    id: "chunk-1",
    factId: "fact-1",
    subject: "s1",
    predicate: "name",
    text: "Ethan",
    vector: new Float32Array([1]),
    world: world1,
  });
  await storage.setChunk({
    id: "chunk-2",
    factId: "fact-2",
    subject: "s2",
    predicate: "name",
    text: "Ethan",
    vector: new Float32Array([1]),
    world: world2,
  });

  const rows = await storage.search({
    worlds: [world2],
    queryText: "ethan",
    queryTerms: ["ethan"],
    queryVector: new Float32Array([1]),
    types: [],
  });

  assertEquals(rows.length, 1);
  assertEquals(rows[0].chunk.world.id, "w2");
});
