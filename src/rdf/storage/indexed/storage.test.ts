import { assertEquals } from "@std/assert";
import type { StoredQuad } from "#/rdf/storage/types.ts";
import { InMemoryQuadStorage } from "#/rdf/storage/in-memory/storage.ts";
import { IndexedQuadStorage } from "./storage.ts";

// Mock PatchHandler for testing
function createMockHandler(): {
  handler: { patch: (patches: unknown[]) => Promise<void> };
  patches: unknown[];
} {
  const patches: unknown[] = [];
  return {
    handler: {
      patch: async (p: unknown[]) => {
        patches.push(...p);
      },
    },
    patches,
  };
}

Deno.test("IndexedQuadStorage: setQuad calls inner and handlers", async () => {
  const inner = new InMemoryQuadStorage();
  const { handler, patches } = createMockHandler();
  const s = new IndexedQuadStorage(inner, [handler]);
  const quad: StoredQuad = {
    subject: "s",
    predicate: "p",
    object: "o",
    graph: "g",
  };
  await s.setQuad(quad);
  const results = await s.findQuads([]);
  assertEquals(results.length, 1);
  assertEquals(patches.length, 1);
});

Deno.test("IndexedQuadStorage: deleteQuad calls inner and handlers", async () => {
  const inner = new InMemoryQuadStorage();
  const { handler, patches } = createMockHandler();
  const s = new IndexedQuadStorage(inner, [handler]);
  const quad: StoredQuad = {
    subject: "s",
    predicate: "p",
    object: "o",
    graph: "g",
  };
  await s.setQuad(quad);
  await s.deleteQuad(quad);
  const results = await s.findQuads([]);
  assertEquals(results.length, 0);
  assertEquals(patches.length, 2); // setQuad + deleteQuad
});

Deno.test("IndexedQuadStorage: clear calls inner and handlers", async () => {
  const inner = new InMemoryQuadStorage();
  const { handler, patches } = createMockHandler();
  const s = new IndexedQuadStorage(inner, [handler]);
  const quad: StoredQuad = {
    subject: "s",
    predicate: "p",
    object: "o",
    graph: "g",
  };
  await s.setQuads([quad]);
  await s.clear();
  const results = await s.findQuads([]);
  assertEquals(results.length, 0);
  assertEquals(patches.length, 2); // setQuads + clear
});

Deno.test("IndexedQuadStorage: findQuads delegates to inner", async () => {
  const inner = new InMemoryQuadStorage();
  const s = new IndexedQuadStorage(inner, []);
  const q1: StoredQuad = {
    subject: "s1",
    predicate: "p",
    object: "o1",
    graph: "g",
  };
  const q2: StoredQuad = {
    subject: "s2",
    predicate: "p",
    object: "o2",
    graph: "g",
  };
  await s.setQuads([q1, q2]);
  const results = await s.findQuads([{ subject: "s1" } as StoredQuad]);
  assertEquals(results.length, 1);
  assertEquals(results[0].subject, "s1");
});
