import { assertEquals } from "@std/assert";
import type { WorldReference } from "#/rpc/openapi/generated/types.gen.ts";
import { InMemoryQuadStorageManager } from "./manager.ts";

Deno.test("InMemoryQuadStorageManager: getQuadStorage returns same instance for same ref", async () => {
  const mgr = new InMemoryQuadStorageManager();
  const a = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
  const b = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
  assertEquals(a, b);
});

Deno.test("InMemoryQuadStorageManager: different worlds are isolated", async () => {
  const mgr = new InMemoryQuadStorageManager();
  const s1 = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
  const s2 = await mgr.getQuadStorage({ namespace: "ns", id: "w2" });
  const quad = {
    subject: "s",
    predicate: "p",
    object: "o",
    graph: "g",
  };
  await s1.setQuad(quad);
  const results = await s2.findQuads([]);
  assertEquals(results.length, 0);
});

Deno.test("InMemoryQuadStorageManager: deleteQuadStorage clears storage and is idempotent", async () => {
  const mgr = new InMemoryQuadStorageManager();
  const s = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
  const quad = {
    subject: "s",
    predicate: "p",
    object: "o",
    graph: "g",
  };
  await s.setQuad(quad);
  await mgr.deleteQuadStorage({ namespace: "ns", id: "w1" });
  const s2 = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
  const results = await s2.findQuads([]);
  assertEquals(results.length, 0);
  await mgr.deleteQuadStorage({ namespace: "ns", id: "w1" });
});
