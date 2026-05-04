import { assertEquals } from "@std/assert";
import { IndexedQuadStorageManager } from "./manager.ts";
import { FakeEmbeddingsService } from "#/indexing/embeddings/fake.ts";
import { InMemoryChunkIndexManager } from "#/indexing/storage/in-memory.ts";

Deno.test("IndexedQuadStorageManager: getQuadStorage returns IndexedQuadStorage", async () => {
  const mgr = new IndexedQuadStorageManager(
    new FakeEmbeddingsService(),
    new InMemoryChunkIndexManager(),
  );
  const s = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
  assertEquals(s !== null, true);
});

Deno.test("IndexedQuadStorageManager: getQuadStorage returns same instance for same ref", async () => {
  const mgr = new IndexedQuadStorageManager(
    new FakeEmbeddingsService(),
    new InMemoryChunkIndexManager(),
  );
  const a = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
  const b = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
  assertEquals(a, b);
});

Deno.test("IndexedQuadStorageManager: deleteQuadStorage clears storage", async () => {
  const mgr = new IndexedQuadStorageManager(
    new FakeEmbeddingsService(),
    new InMemoryChunkIndexManager(),
  );
  await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
  await mgr.deleteQuadStorage({ namespace: "ns", id: "w1" });
  const s = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
  const results = await s.findQuads([]);
  assertEquals(results.length, 0);
});
