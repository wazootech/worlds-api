import { assertEquals } from "@std/assert";
import { IndexedQuadStorage } from "./indexed-quad-storage.ts";
import { InMemoryQuadStorage } from "./in-memory-quad-storage.ts";
import type { StoredQuad } from "./quad.ts";
import type { Patch, PatchHandler } from "#/indexing/search/types.ts";

function makeQuad(overrides: Partial<StoredQuad> = {}): StoredQuad {
  return {
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    object: "hello",
    graph: "",
    ...overrides,
  };
}

class SpyPatchHandler implements PatchHandler {
  patches: Patch[][] = [];
  async patch(patches: Patch[]): Promise<void> {
    this.patches.push(patches);
  }
}

Deno.test("IndexedQuadStorage: setQuad dispatches insertion patch", async () => {
  const inner = new InMemoryQuadStorage();
  const spy = new SpyPatchHandler();
  const storage = new IndexedQuadStorage(inner, [spy]);

  const quad = makeQuad();
  await storage.setQuad(quad);

  assertEquals(spy.patches.length, 1);
  assertEquals(spy.patches[0].length, 1);
  assertEquals(spy.patches[0][0].insertions.length, 1);
  assertEquals(spy.patches[0][0].deletions.length, 0);
  assertEquals(spy.patches[0][0].insertions[0], quad);

  // Also stored in inner
  const results = await inner.findQuads([]);
  assertEquals(results.length, 1);
});

Deno.test("IndexedQuadStorage: deleteQuad dispatches deletion patch", async () => {
  const inner = new InMemoryQuadStorage();
  const spy = new SpyPatchHandler();
  const storage = new IndexedQuadStorage(inner, [spy]);

  const quad = makeQuad();
  await storage.setQuad(quad);
  spy.patches = []; // reset

  await storage.deleteQuad(quad);

  assertEquals(spy.patches.length, 1);
  assertEquals(spy.patches[0][0].insertions.length, 0);
  assertEquals(spy.patches[0][0].deletions.length, 1);
  assertEquals(spy.patches[0][0].deletions[0], quad);
});

Deno.test("IndexedQuadStorage: setQuads dispatches batch insertion patch", async () => {
  const inner = new InMemoryQuadStorage();
  const spy = new SpyPatchHandler();
  const storage = new IndexedQuadStorage(inner, [spy]);

  const quads = [
    makeQuad({ subject: "https://example.org/a" }),
    makeQuad({ subject: "https://example.org/b" }),
  ];
  await storage.setQuads(quads);

  assertEquals(spy.patches.length, 1);
  assertEquals(spy.patches[0][0].insertions.length, 2);
});

Deno.test("IndexedQuadStorage: setQuads with empty array is no-op", async () => {
  const inner = new InMemoryQuadStorage();
  const spy = new SpyPatchHandler();
  const storage = new IndexedQuadStorage(inner, [spy]);

  await storage.setQuads([]);

  assertEquals(spy.patches.length, 0);
});

Deno.test("IndexedQuadStorage: deleteQuads dispatches batch deletion patch", async () => {
  const inner = new InMemoryQuadStorage();
  const spy = new SpyPatchHandler();
  const storage = new IndexedQuadStorage(inner, [spy]);

  const quads = [
    makeQuad({ subject: "https://example.org/a" }),
    makeQuad({ subject: "https://example.org/b" }),
  ];
  await storage.setQuads(quads);
  spy.patches = [];

  await storage.deleteQuads(quads);

  assertEquals(spy.patches.length, 1);
  assertEquals(spy.patches[0][0].deletions.length, 2);
});

Deno.test("IndexedQuadStorage: deleteQuads with empty array is no-op", async () => {
  const inner = new InMemoryQuadStorage();
  const spy = new SpyPatchHandler();
  const storage = new IndexedQuadStorage(inner, [spy]);

  await storage.deleteQuads([]);

  assertEquals(spy.patches.length, 0);
});

Deno.test("IndexedQuadStorage: clear dispatches deletion patch for all existing quads", async () => {
  const inner = new InMemoryQuadStorage();
  const spy = new SpyPatchHandler();
  const storage = new IndexedQuadStorage(inner, [spy]);

  await storage.setQuads([
    makeQuad({ subject: "https://example.org/a" }),
    makeQuad({ subject: "https://example.org/b" }),
  ]);
  spy.patches = [];

  await storage.clear();

  assertEquals(spy.patches.length, 1);
  assertEquals(spy.patches[0][0].deletions.length, 2);
  assertEquals(spy.patches[0][0].insertions.length, 0);

  // Inner should be empty
  const results = await inner.findQuads([]);
  assertEquals(results.length, 0);
});

Deno.test("IndexedQuadStorage: clear on empty store does not dispatch", async () => {
  const inner = new InMemoryQuadStorage();
  const spy = new SpyPatchHandler();
  const storage = new IndexedQuadStorage(inner, [spy]);

  await storage.clear();

  assertEquals(spy.patches.length, 0);
});

Deno.test("IndexedQuadStorage: findQuads delegates to inner", async () => {
  const inner = new InMemoryQuadStorage();
  const spy = new SpyPatchHandler();
  const storage = new IndexedQuadStorage(inner, [spy]);

  await storage.setQuad(makeQuad({ subject: "https://example.org/a" }));
  await storage.setQuad(makeQuad({ subject: "https://example.org/b" }));

  const all = await storage.findQuads([]);
  assertEquals(all.length, 2);

  // findQuads should NOT dispatch any patches
  assertEquals(spy.patches.length, 2); // only the 2 setQuad calls
});

Deno.test("IndexedQuadStorage: dispatches to multiple handlers", async () => {
  const inner = new InMemoryQuadStorage();
  const spy1 = new SpyPatchHandler();
  const spy2 = new SpyPatchHandler();
  const storage = new IndexedQuadStorage(inner, [spy1, spy2]);

  await storage.setQuad(makeQuad());

  assertEquals(spy1.patches.length, 1);
  assertEquals(spy2.patches.length, 1);
});
