import { assertEquals } from "@std/assert";
import { IndexedQuadStorageManager } from "./manager.ts";

// Minimal mocks for testing
function createMockEmbeddings() {
  return {
    dimensions: 384,
  } as unknown as import("#/indexing/embeddings/interface.ts").EmbeddingsService;
}

function createMockChunks() {
  return {
    getChunkIndex: async () => ({}),
    setIndexState: async () => {},
    deleteChunkIndex: async () => {},
  } as unknown as import("#/indexing/storage/interface.ts").ChunkIndexManager;
}

Deno.test("IndexedQuadStorageManager: getQuadStorage returns IndexedQuadStorage", async () => {
  const mgr = new IndexedQuadStorageManager(
    createMockEmbeddings(),
    createMockChunks(),
  );
  const s = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
  assertEquals(s !== null, true);
});

Deno.test("IndexedQuadStorageManager: getQuadStorage returns same instance for same ref", async () => {
  const mgr = new IndexedQuadStorageManager(
    createMockEmbeddings(),
    createMockChunks(),
  );
  const a = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
  const b = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
  assertEquals(a, b);
});

Deno.test("IndexedQuadStorageManager: deleteQuadStorage clears storage", async () => {
  const mgr = new IndexedQuadStorageManager(
    createMockEmbeddings(),
    createMockChunks(),
  );
  await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
  await mgr.deleteQuadStorage({ namespace: "ns", id: "w1" });
  const s = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
  const results = await s.findQuads([]);
  assertEquals(results.length, 0);
});
