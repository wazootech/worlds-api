import { assertEquals } from "@std/assert";
import { FakeEmbeddingsService } from "#/indexing/embeddings/fake.ts";
import { InMemoryChunkIndexManager } from "#/indexing/storage/in-memory.ts";
import { IndexedQuadStorageManager } from "./indexed-quad-storage-manager.ts";

Deno.test("IndexedQuadStorageManager: getQuadStorage returns same instance for same world", async () => {
  const embeddings = new FakeEmbeddingsService();
  const chunks = new InMemoryChunkIndexManager();
  const storage = new IndexedQuadStorageManager(embeddings, chunks);
  const ref = { namespace: "ns", id: "w1" };

  const store1 = await storage.getQuadStorage(ref);
  const store2 = await storage.getQuadStorage(ref);

  assertEquals(store1, store2);
});

Deno.test("IndexedQuadStorageManager: different worlds have isolated storage", async () => {
  const embeddings = new FakeEmbeddingsService();
  const chunks = new InMemoryChunkIndexManager();
  const storage = new IndexedQuadStorageManager(embeddings, chunks);

  const store1 = await storage.getQuadStorage({ namespace: "ns", id: "w1" });
  const store2 = await storage.getQuadStorage({ namespace: "ns", id: "w2" });

  await store1.setQuad({
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    object: "Hello world",
    graph: "g",
  });

  const results = await store2.findQuads([]);
  assertEquals(results.length, 0);
});

Deno.test("IndexedQuadStorageManager: deleteQuadStorage clears wrapped storage", async () => {
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

  const newStore = await storage.getQuadStorage(ref);
  const results = await newStore.findQuads([]);
  assertEquals(results.length, 0);
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

Deno.test("IndexedQuadStorageManager: deleteQuadStorage is no-op for missing", async () => {
  const embeddings = new FakeEmbeddingsService();
  const chunks = new InMemoryChunkIndexManager();
  const storage = new IndexedQuadStorageManager(embeddings, chunks);

  await storage.deleteQuadStorage({ namespace: "ns", id: "missing" });

  const store = await storage.getQuadStorage({
    namespace: "ns",
    id: "missing",
  });
  const results = await store.findQuads([]);
  assertEquals(results.length, 0);
});
