import { assertEquals } from "@std/assert";
import { InMemoryFactStorageManager } from "./in-memory-fact-storage-manager.ts";

Deno.test("InMemoryFactStorageManager: getFactStorage returns same instance for same world", async () => {
  const storage = new InMemoryFactStorageManager();
  const ref = { namespace: "ns", id: "w1" };

  const store1 = await storage.getFactStorage(ref);
  const store2 = await storage.getFactStorage(ref);

  assertEquals(store1, store2);
});

Deno.test("InMemoryFactStorageManager: different worlds have isolated storage", async () => {
  const storage = new InMemoryFactStorageManager();

  const store1 = await storage.getFactStorage({ namespace: "ns", id: "w1" });
  const store2 = await storage.getFactStorage({ namespace: "ns", id: "w2" });

  await store1.setFact({
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    object: "Hello world",
    graph: "",
  });

  const results = await store2.findFacts([]);
  assertEquals(results.length, 0);
});

Deno.test("InMemoryFactStorageManager: deleteFactStorage clears wrapped storage", async () => {
  const storage = new InMemoryFactStorageManager();
  const ref = { namespace: "ns", id: "w1" };

  const store = await storage.getFactStorage(ref);
  await store.setFact({
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    object: "Hello world",
    graph: "",
  });

  await storage.deleteFactStorage(ref);

  const newStore = await storage.getFactStorage(ref);
  const results = await newStore.findFacts([]);
  assertEquals(results.length, 0);
});

Deno.test("InMemoryFactStorageManager: deleteFactStorage is no-op for missing", async () => {
  const storage = new InMemoryFactStorageManager();

  await storage.deleteFactStorage({ namespace: "ns", id: "missing" });

  const store = await storage.getFactStorage({
    namespace: "ns",
    id: "missing",
  });
  const results = await store.findFacts([]);
  assertEquals(results.length, 0);
});

Deno.test("InMemoryFactStorageManager: stores and retrieves facts", async () => {
  const storage = new InMemoryFactStorageManager();
  const ref = { namespace: "ns", id: "w1" };

  const store = await storage.getFactStorage(ref);
  await store.setFacts([
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

  const results = await store.findFacts([]);
  assertEquals(results.length, 2);
});
