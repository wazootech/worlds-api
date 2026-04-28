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

  await storage.upsert({
    id: "chunk-1",
    factId: "fact-1",
    subject: "s",
    predicate: "p",
    text: "alpha",
    vector: new Float32Array([1]),
    world,
  });
  await storage.upsert({
    id: "chunk-2",
    factId: "fact-1",
    subject: "s",
    predicate: "p",
    text: "beta",
    vector: new Float32Array([1]),
    world,
  });
  await storage.upsert({
    id: "chunk-3",
    factId: "fact-2",
    subject: "s",
    predicate: "p",
    text: "gamma",
    vector: new Float32Array([1]),
    world,
  });

  await storage.deleteByFactId(world, "fact-1");

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
  await storage.upsert({
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
