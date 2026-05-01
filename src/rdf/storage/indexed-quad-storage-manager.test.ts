import { assertEquals } from "@std/assert";
import { FakeEmbeddingsService } from "#/indexing/embeddings/fake.ts";
import { InMemoryChunkIndexManager } from "#/indexing/storage/in-memory.ts";
import { IndexedQuadStorageManager } from "./indexed-quad-storage-manager.ts";
import { testQuadStorageManager } from "./contract.test.ts";

testQuadStorageManager("IndexedQuadStorageManager", (_suffix: string) => {
  const embeddings = new FakeEmbeddingsService();
  const chunks = new InMemoryChunkIndexManager();
  return new IndexedQuadStorageManager(embeddings, chunks);
});

Deno.test("IndexedQuadStorageManager: deleteQuadStorage clears chunk index", async () => {
  const embeddings = new FakeEmbeddingsService();
  const chunks = new InMemoryChunkIndexManager();
  const storage = new IndexedQuadStorageManager(embeddings, chunks);
  const ref = { namespace: "ns", id: "w1" };

  const store = await storage.getQuadStorage(ref);
  await store.setQuad({
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    object: "Hello world",
    graph: "g",
  });

  await storage.deleteQuadStorage(ref);

  const idx = await chunks.getChunkIndex(ref);
  const chunksAfter = await idx.getAll();
  assertEquals(chunksAfter.length, 0);
});
