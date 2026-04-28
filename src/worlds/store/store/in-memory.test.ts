import { assertEquals } from "@std/assert";
import { InMemoryStoreStorage } from "./in-memory.ts";

Deno.test("InMemoryStoreStorage: getQuadStorage returns same instance for same world", async () => {
  const storage = new InMemoryStoreStorage();
  const ref = { namespace: "ns", id: "w1" };

  const store1 = await storage.getQuadStorage(ref);
  const store2 = await storage.getQuadStorage(ref);

  assertEquals(store1, store2);
});

Deno.test("InMemoryStoreStorage: different worlds have isolated storage", async () => {
  const storage = new InMemoryStoreStorage();

  const store1 = await storage.getQuadStorage({ namespace: "ns", id: "w1" });
  const store2 = await storage.getQuadStorage({ namespace: "ns", id: "w2" });

  await store1.setQuad({
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    object: "o1",
    graph: "g",
  });

  const results = await store2.findQuads([]);
  assertEquals(results.length, 0);
});

Deno.test("InMemoryStoreStorage: deleteQuadStorage removes storage", async () => {
  const storage = new InMemoryStoreStorage();
  const ref = { namespace: "ns", id: "w1" };

  const store = await storage.getQuadStorage(ref);
  await store.setQuad({
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    object: "o",
    graph: "g",
  });

  await storage.deleteQuadStorage(ref);

  const newStore = await storage.getQuadStorage(ref);
  const results = await newStore.findQuads([]);
  assertEquals(results.length, 0);
});

Deno.test("InMemoryStoreStorage: deleteQuadStorage is no-op for missing", async () => {
  const storage = new InMemoryStoreStorage();

  await storage.deleteQuadStorage({ namespace: "ns", id: "missing" });

  const store = await storage.getQuadStorage({
    namespace: "ns",
    id: "missing",
  });
  const results = await store.findQuads([]);
  assertEquals(results.length, 0);
});
