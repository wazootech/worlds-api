import { assertEquals } from "@std/assert";
import { InMemoryQuadStorageManager } from "./in-memory-quad-storage-manager.ts";

Deno.test("InMemoryQuadStorageManager: getQuadStorage returns same instance for same world", async () => {
  const storage = new InMemoryQuadStorageManager();
  const ref = { namespace: "ns", id: "w1" };

  const store1 = await storage.getQuadStorage(ref);
  const store2 = await storage.getQuadStorage(ref);

  assertEquals(store1, store2);
});

Deno.test("InMemoryQuadStorageManager: different worlds have isolated storage", async () => {
  const storage = new InMemoryQuadStorageManager();

  const store1 = await storage.getQuadStorage({ namespace: "ns", id: "w1" });
  const store2 = await storage.getQuadStorage({ namespace: "ns", id: "w2" });

  await store1.setQuad({
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    object: "Hello world",
    graph: "",
  });

  const results = await store2.findQuads([]);
  assertEquals(results.length, 0);
});

Deno.test("InMemoryQuadStorageManager: deleteQuadStorage clears wrapped storage", async () => {
  const storage = new InMemoryQuadStorageManager();
  const ref = { namespace: "ns", id: "w1" };

  const store = await storage.getQuadStorage(ref);
  await store.setQuad({
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    object: "Hello world",
    graph: "",
  });

  await storage.deleteQuadStorage(ref);

  const newStore = await storage.getQuadStorage(ref);
  const results = await newStore.findQuads([]);
  assertEquals(results.length, 0);
});

Deno.test("InMemoryQuadStorageManager: deleteQuadStorage is no-op for missing", async () => {
  const storage = new InMemoryQuadStorageManager();

  await storage.deleteQuadStorage({ namespace: "ns", id: "missing" });

  const store = await storage.getQuadStorage({
    namespace: "ns",
    id: "missing",
  });
  const results = await store.findQuads([]);
  assertEquals(results.length, 0);
});

Deno.test("InMemoryQuadStorageManager: stores and retrieves quads", async () => {
  const storage = new InMemoryQuadStorageManager();
  const ref = { namespace: "ns", id: "w1" };

  const store = await storage.getQuadStorage(ref);
  await store.setQuads([
    {
      subject: "https://example.org/s1",
      predicate: "https://example.org/p1",
      object: "Hello",
      graph: "",
    },
    {
      subject: "https://example.org/s2",
      predicate: "https://example.org/p2",
      object: "World",
      graph: "",
    },
  ]);

  const results = await store.findQuads([]);
  assertEquals(results.length, 2);
});
