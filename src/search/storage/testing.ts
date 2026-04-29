import { assertEquals } from "@std/assert";
import type {
  ChunkIndexManager,
  ChunkIndexSearchQuery,
  ChunkRecord,
} from "./interface.ts";

export interface MakeChunkOverrides extends Partial<ChunkRecord> {
  id: string;
  factId: string;
}

export function makeChunk(overrides: MakeChunkOverrides): ChunkRecord {
  return {
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    text: "hello world",
    vector: Float32Array.from([1, 0, 0]),
    world: { namespace: "ns", id: "w1" },
    ...overrides,
  };
}

/**
 * Shared test suite for ChunkIndexManager implementations.
 */
export async function testChunkIndexManager(manager: ChunkIndexManager) {
  const world = { namespace: "ns", id: "w1" };
  const index = await manager.getChunkIndex(world);

  // 1. setChunk and getAll
  const chunk = makeChunk({ id: "c1", factId: "f1", world });
  await index.setChunk(chunk);
  let result = await index.getAll();
  assertEquals(result.length, 1);
  assertEquals(result[0].id, "c1");

  // 2. setChunk replaces existing
  await index.setChunk(
    makeChunk({ id: "c1", factId: "f1", text: "updated", world }),
  );
  result = await index.getAll();
  assertEquals(result.length, 1);
  assertEquals(result[0].text, "updated");

  // 3. getAll returns empty for unknown world
  const unknownWorld = { namespace: "ns", id: "unknown" };
  const unknownIndex = await manager.getChunkIndex(unknownWorld);
  assertEquals(await unknownIndex.getAll(), []);

  // 4. deleteChunk removes chunks for a fact
  await index.setChunk(makeChunk({ id: "c2", factId: "f1", world })); // same fact, different chunk
  await index.setChunk(makeChunk({ id: "c3", factId: "f2", world })); // different fact
  await index.deleteChunk("f1");
  result = await index.getAll();
  assertEquals(result.length, 1);
  assertEquals(result[0].id, "c3");

  // 5. setIndexState and getIndexState
  assertEquals(await manager.getIndexState(world), null);
  await manager.setIndexState({
    world,
    indexedAt: 12345,
    embeddingDimensions: 3,
  });
  const state = await manager.getIndexState(world);
  assertEquals(state?.indexedAt, 12345);
  assertEquals(state?.embeddingDimensions, 3);

  // 6. deleteChunkIndex removes all chunks and state
  await manager.deleteChunkIndex(world);
  const afterDeleteIndex = await manager.getChunkIndex(world);
  assertEquals(await afterDeleteIndex.getAll(), []);
  assertEquals(await manager.getIndexState(world), null);

  // 7. search FTS
  const idx = await manager.getChunkIndex(world);
  await idx.setChunk(
    makeChunk({
      id: "s1",
      factId: "f1",
      text: "Alice is here",
      subject: "urn:alice",
      predicate: "urn:name",
      world,
    }),
  );
  await idx.setChunk(
    makeChunk({
      id: "s2",
      factId: "f2",
      text: "Bob is here",
      subject: "urn:bob",
      predicate: "urn:name",
      world,
    }),
  );
  await idx.setChunk(
    makeChunk({
      id: "s3",
      factId: "f3",
      text: "Alice is old",
      subject: "urn:alice",
      predicate: "urn:age",
      world,
    }),
  );

  // Basic search
  let rows = await idx.search(
    {
      queryText: "alice",
      queryTerms: ["alice"],
      queryVector: [1, 0, 0],
    } satisfies ChunkIndexSearchQuery,
  );
  assertEquals(rows.length, 2);

  // Filter by subject
  rows = await idx.search(
    {
      queryText: "alice",
      queryTerms: ["alice"],
      queryVector: [1, 0, 0],
      subjects: ["urn:alice"],
    } satisfies ChunkIndexSearchQuery,
  );
  assertEquals(rows.length, 2);
  assertEquals(rows.every((r) => r.chunk.subject === "urn:alice"), true);

  // Filter by predicate
  rows = await idx.search(
    {
      queryText: "alice",
      queryTerms: ["alice"],
      queryVector: [1, 0, 0],
      predicates: ["urn:name"],
    } satisfies ChunkIndexSearchQuery,
  );
  assertEquals(rows.length, 1);
  assertEquals(rows[0].chunk.id, "s1");

  // Multi-world search
  const world2 = { namespace: "ns", id: "w2" };
  const idx2 = await manager.getChunkIndex(world2);
  await idx2.setChunk(
    makeChunk({
      id: "w2-c1",
      factId: "f4",
      text: "Charlie in world 2",
      world: world2,
    }),
  );

  const query = {
    queryText: "here charlie",
    queryTerms: ["here", "charlie"],
    queryVector: [1, 0, 0],
  } satisfies ChunkIndexSearchQuery;

  rows = [...await idx.search(query), ...await idx2.search(query)];
  assertEquals(rows.length, 3);

  await manager.deleteChunkIndex(world);
  await manager.deleteChunkIndex(world2);
}
