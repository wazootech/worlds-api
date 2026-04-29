import { assertEquals } from "@std/assert";
import { InMemoryChunkStorage } from "./in-memory.ts";
import type { ChunkRecord } from "./types.ts";

function makeChunk(overrides: Partial<ChunkRecord> & { id: string; factId: string }): ChunkRecord {
  return {
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    text: "hello world",
    vector: Float32Array.from([1, 0, 0]),
    world: { namespace: "ns", id: "w1" },
    ...overrides,
  };
}

Deno.test("InMemoryChunkStorage: setChunk and getByWorld", async () => {
  const storage = new InMemoryChunkStorage();
  const chunk = makeChunk({ id: "c1", factId: "f1" });
  await storage.setChunk(chunk);

  const result = await storage.getByWorld({ namespace: "ns", id: "w1" });
  assertEquals(result.length, 1);
  assertEquals(result[0].id, "c1");
});

Deno.test("InMemoryChunkStorage: getByWorld returns empty for unknown world", async () => {
  const storage = new InMemoryChunkStorage();
  const result = await storage.getByWorld({ namespace: "ns", id: "unknown" });
  assertEquals(result, []);
});

Deno.test("InMemoryChunkStorage: deleteChunk removes chunks for a fact", async () => {
  const storage = new InMemoryChunkStorage();
  await storage.setChunk(makeChunk({ id: "c1", factId: "f1" }));
  await storage.setChunk(makeChunk({ id: "c2", factId: "f1" })); // same fact, different chunk
  await storage.setChunk(makeChunk({ id: "c3", factId: "f2" })); // different fact

  await storage.deleteChunk({ namespace: "ns", id: "w1" }, "f1");

  const result = await storage.getByWorld({ namespace: "ns", id: "w1" });
  assertEquals(result.length, 1);
  assertEquals(result[0].id, "c3");
});

Deno.test("InMemoryChunkStorage: deleteChunk is no-op for missing fact", async () => {
  const storage = new InMemoryChunkStorage();
  await storage.deleteChunk({ namespace: "ns", id: "w1" }, "nonexistent");
  // Should not throw
});

Deno.test("InMemoryChunkStorage: clearWorld removes all chunks for a world", async () => {
  const storage = new InMemoryChunkStorage();
  await storage.setChunk(makeChunk({ id: "c1", factId: "f1" }));
  await storage.setChunk(makeChunk({ id: "c2", factId: "f2" }));

  await storage.clearWorld({ namespace: "ns", id: "w1" });

  const result = await storage.getByWorld({ namespace: "ns", id: "w1" });
  assertEquals(result, []);
});

Deno.test("InMemoryChunkStorage: clearWorld does not affect other worlds", async () => {
  const storage = new InMemoryChunkStorage();
  await storage.setChunk(makeChunk({ id: "c1", factId: "f1", world: { namespace: "ns", id: "w1" } }));
  await storage.setChunk(makeChunk({ id: "c2", factId: "f2", world: { namespace: "ns", id: "w2" } }));

  await storage.clearWorld({ namespace: "ns", id: "w1" });

  const w1 = await storage.getByWorld({ namespace: "ns", id: "w1" });
  const w2 = await storage.getByWorld({ namespace: "ns", id: "w2" });
  assertEquals(w1, []);
  assertEquals(w2.length, 1);
});

Deno.test("InMemoryChunkStorage: markWorldIndexed and getIndexState", async () => {
  const storage = new InMemoryChunkStorage();
  const world = { namespace: "ns", id: "w1" };

  assertEquals(await storage.getIndexState(world), null);

  await storage.markWorldIndexed({ world, indexedAt: 12345, embeddingDimensions: 3 });

  const state = await storage.getIndexState(world);
  assertEquals(state?.indexedAt, 12345);
  assertEquals(state?.embeddingDimensions, 3);
});

Deno.test("InMemoryChunkStorage: clearWorld also clears index state", async () => {
  const storage = new InMemoryChunkStorage();
  const world = { namespace: "ns", id: "w1" };
  await storage.markWorldIndexed({ world, indexedAt: 12345, embeddingDimensions: 3 });
  await storage.clearWorld(world);
  assertEquals(await storage.getIndexState(world), null);
});

Deno.test("InMemoryChunkStorage: search with FTS term matching", async () => {
  const storage = new InMemoryChunkStorage();
  await storage.setChunk(makeChunk({
    id: "c1",
    factId: "f1",
    text: "Alice is a programmer",
    vector: Float32Array.from([1, 0, 0]),
  }));
  await storage.setChunk(makeChunk({
    id: "c2",
    factId: "f2",
    text: "Bob is a designer",
    vector: Float32Array.from([0, 1, 0]),
  }));

  const rows = await storage.search({
    worlds: [{ namespace: "ns", id: "w1" }],
    queryText: "alice",
    queryTerms: ["alice"],
    queryVector: [1, 0, 0],
  });

  assertEquals(rows.length, 1);
  assertEquals(rows[0].chunk.text, "Alice is a programmer");
  assertEquals(rows[0].ftsRank, 1);
});

Deno.test("InMemoryChunkStorage: search returns empty when no terms match", async () => {
  const storage = new InMemoryChunkStorage();
  await storage.setChunk(makeChunk({ id: "c1", factId: "f1", text: "hello" }));

  const rows = await storage.search({
    worlds: [{ namespace: "ns", id: "w1" }],
    queryText: "xyz",
    queryTerms: ["xyz"],
    queryVector: [1, 0, 0],
  });

  assertEquals(rows, []);
});

Deno.test("InMemoryChunkStorage: search filters by subject", async () => {
  const storage = new InMemoryChunkStorage();
  await storage.setChunk(makeChunk({
    id: "c1",
    factId: "f1",
    text: "hello",
    subject: "https://example.org/alice",
  }));
  await storage.setChunk(makeChunk({
    id: "c2",
    factId: "f2",
    text: "hello",
    subject: "https://example.org/bob",
  }));

  const rows = await storage.search({
    worlds: [{ namespace: "ns", id: "w1" }],
    queryText: "hello",
    queryTerms: ["hello"],
    queryVector: [1, 0, 0],
    subjects: ["https://example.org/alice"],
  });

  assertEquals(rows.length, 1);
  assertEquals(rows[0].chunk.subject, "https://example.org/alice");
});

Deno.test("InMemoryChunkStorage: search filters by predicate", async () => {
  const storage = new InMemoryChunkStorage();
  await storage.setChunk(makeChunk({
    id: "c1",
    factId: "f1",
    text: "hello",
    predicate: "https://example.org/name",
  }));
  await storage.setChunk(makeChunk({
    id: "c2",
    factId: "f2",
    text: "hello",
    predicate: "https://example.org/age",
  }));

  const rows = await storage.search({
    worlds: [{ namespace: "ns", id: "w1" }],
    queryText: "hello",
    queryTerms: ["hello"],
    queryVector: [1, 0, 0],
    predicates: ["https://example.org/name"],
  });

  assertEquals(rows.length, 1);
  assertEquals(rows[0].chunk.predicate, "https://example.org/name");
});

Deno.test("InMemoryChunkStorage: search sorts by score descending", async () => {
  const storage = new InMemoryChunkStorage();
  // c1 matches 1 term, c2 matches 2 terms
  await storage.setChunk(makeChunk({
    id: "c1",
    factId: "f1",
    text: "alice",
    vector: Float32Array.from([1, 0, 0]),
  }));
  await storage.setChunk(makeChunk({
    id: "c2",
    factId: "f2",
    text: "alice bob",
    vector: Float32Array.from([0, 1, 0]),
  }));

  const rows = await storage.search({
    worlds: [{ namespace: "ns", id: "w1" }],
    queryText: "alice bob",
    queryTerms: ["alice", "bob"],
    queryVector: [0, 0, 1],
  });

  assertEquals(rows.length, 2);
  // c2 should be first (higher FTS score)
  assertEquals(rows[0].chunk.id, "c2");
  assertEquals(rows[1].chunk.id, "c1");
});

Deno.test("InMemoryChunkStorage: setChunk replaces existing chunk", async () => {
  const storage = new InMemoryChunkStorage();
  await storage.setChunk(makeChunk({ id: "c1", factId: "f1", text: "old" }));
  await storage.setChunk(makeChunk({ id: "c1", factId: "f1", text: "new" }));

  const result = await storage.getByWorld({ namespace: "ns", id: "w1" });
  assertEquals(result.length, 1);
  assertEquals(result[0].text, "new");
});
