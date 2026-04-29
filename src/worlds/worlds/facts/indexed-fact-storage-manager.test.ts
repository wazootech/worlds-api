import { assertEquals } from "@std/assert";
import { PlaceholderEmbeddingsService } from "#/worlds/embeddings/placeholder.ts";
import { InMemoryChunkStorage } from "#/worlds/search/chunks/in-memory.ts";
import { IndexedFactStorageManager } from "./indexed-fact-storage-manager.ts";

Deno.test("IndexedFactStorageManager: getFactStorage returns same instance for same world", async () => {
  const embeddings = new PlaceholderEmbeddingsService();
  const chunks = new InMemoryChunkStorage();
  const storage = new IndexedFactStorageManager(embeddings, chunks);
  const ref = { namespace: "ns", id: "w1" };

  const store1 = await storage.getFactStorage(ref);
  const store2 = await storage.getFactStorage(ref);

  assertEquals(store1, store2);
});

Deno.test("IndexedFactStorageManager: different worlds have isolated storage", async () => {
  const embeddings = new PlaceholderEmbeddingsService();
  const chunks = new InMemoryChunkStorage();
  const storage = new IndexedFactStorageManager(embeddings, chunks);

  const store1 = await storage.getFactStorage({ namespace: "ns", id: "w1" });
  const store2 = await storage.getFactStorage({ namespace: "ns", id: "w2" });

  await store1.setFact({
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    object: "Hello world",
    graph: "g",
  });

  const results = await store2.findFacts([]);
  assertEquals(results.length, 0);
});

Deno.test("IndexedFactStorageManager: deleteFactStorage clears wrapped storage", async () => {
  const embeddings = new PlaceholderEmbeddingsService();
  const chunks = new InMemoryChunkStorage();
  const storage = new IndexedFactStorageManager(embeddings, chunks);
  const ref = { namespace: "ns", id: "w1" };

  const store = await storage.getFactStorage(ref);
  await store.setFact({
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    object: "Hello world",
    graph: "g",
  });

  await storage.deleteFactStorage(ref);

  const newStore = await storage.getFactStorage(ref);
  const results = await newStore.findFacts([]);
  assertEquals(results.length, 0);
});

Deno.test("IndexedFactStorageManager: deleteFactStorage clears chunk index", async () => {
  const embeddings = new PlaceholderEmbeddingsService();
  const chunks = new InMemoryChunkStorage();
  const storage = new IndexedFactStorageManager(embeddings, chunks);
  const ref = { namespace: "ns", id: "w1" };

  const store = await storage.getFactStorage(ref);
  await store.setFact({
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    object: "Hello world",
    graph: "g",
  });

  await storage.deleteFactStorage(ref);

  const chunksAfter = await chunks.getByWorld(ref);
  assertEquals(chunksAfter.length, 0);
});

Deno.test("IndexedFactStorageManager: deleteFactStorage is no-op for missing", async () => {
  const embeddings = new PlaceholderEmbeddingsService();
  const chunks = new InMemoryChunkStorage();
  const storage = new IndexedFactStorageManager(embeddings, chunks);

  await storage.deleteFactStorage({ namespace: "ns", id: "missing" });

  const store = await storage.getFactStorage({
    namespace: "ns",
    id: "missing",
  });
  const results = await store.findFacts([]);
  assertEquals(results.length, 0);
});
