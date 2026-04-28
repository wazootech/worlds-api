import { assertEquals } from "@std/assert";
import { InMemoryChunkStorage } from "./in-memory.ts";

Deno.test("InMemoryChunkStorage: stores chunks with index state separately", async () => {
  const storage = new InMemoryChunkStorage();
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

Deno.test("InMemoryChunkStorage: deletes chunks by fact id", async () => {
  const storage = new InMemoryChunkStorage();
  const world = { namespace: "ns", id: "w1" };

  await storage.setChunk({
    id: "chunk-1",
    factId: "fact-1",
    subject: "s",
    predicate: "p",
    text: "alpha",
    vector: new Float32Array([1]),
    world,
  });
  await storage.setChunk({
    id: "chunk-2",
    factId: "fact-1",
    subject: "s",
    predicate: "p",
    text: "beta",
    vector: new Float32Array([1]),
    world,
  });
  await storage.setChunk({
    id: "chunk-3",
    factId: "fact-2",
    subject: "s",
    predicate: "p",
    text: "gamma",
    vector: new Float32Array([1]),
    world,
  });

  await storage.deleteChunk(world, "fact-1");

  assertEquals((await storage.getByWorld(world)).map((c) => c.id), ["chunk-3"]);
});

Deno.test("InMemoryChunkStorage: clearWorld removes rows and index state", async () => {
  const storage = new InMemoryChunkStorage();
  const world = { namespace: "ns", id: "w1" };

  await storage.markWorldIndexed({
    world,
    indexedAt: 123,
    embeddingDimensions: 384,
  });
  await storage.setChunk({
    id: "chunk-1",
    factId: "fact-1",
    subject: "s",
    predicate: "p",
    text: "alpha",
    vector: new Float32Array([1]),
    world,
  });

  await storage.clearWorld(world);

  assertEquals(await storage.getByWorld(world), []);
  assertEquals(await storage.getIndexState(world), null);
});

Deno.test("InMemoryChunkStorage: searches chunks with filters and ranking", async () => {
  const storage = new InMemoryChunkStorage();
  const world = { namespace: "ns", id: "w1" };

  await storage.setChunk({
    id: "type-1",
    factId: "fact-type-1",
    subject: "person:1",
    predicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
    text: "Person",
    vector: new Float32Array([1, 0]),
    world,
  });
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
    types: ["Person"],
  });

  assertEquals(rows.length, 1);
  assertEquals(rows[0].chunk.id, "chunk-1");
  assertEquals(rows[0].ftsRank, 2);
});

Deno.test("InMemoryChunkStorage: search respects world boundary", async () => {
  const storage = new InMemoryChunkStorage();
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
  });

  assertEquals(rows.map((r) => r.chunk.id), ["chunk-2"]);
});
