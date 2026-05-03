import { assertEquals } from "@std/assert";
import { InMemoryQuadStorageManager } from "./in-memory-quad-storage-manager.ts";
import { testQuadStorageManager } from "./testing.ts";

testQuadStorageManager(
  "InMemoryQuadStorageManager",
  (_suffix: string) => new InMemoryQuadStorageManager(),
);

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
