import { assertEquals } from "@std/assert";
import { IndexedFactStorage } from "./indexed.ts";
import { InMemoryFactStorage } from "./in-memory.ts";
import type { StoredFact } from "./types.ts";
import type { Patch, PatchHandler } from "./index/types.ts";

function makeFact(overrides: Partial<StoredFact> = {}): StoredFact {
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

Deno.test("IndexedFactStorage: setFact dispatches insertion patch", async () => {
  const inner = new InMemoryFactStorage();
  const spy = new SpyPatchHandler();
  const storage = new IndexedFactStorage(inner, [spy]);

  const fact = makeFact();
  await storage.setFact(fact);

  assertEquals(spy.patches.length, 1);
  assertEquals(spy.patches[0].length, 1);
  assertEquals(spy.patches[0][0].insertions.length, 1);
  assertEquals(spy.patches[0][0].deletions.length, 0);
  assertEquals(spy.patches[0][0].insertions[0], fact);

  // Also stored in inner
  const results = await inner.findFacts([]);
  assertEquals(results.length, 1);
});

Deno.test("IndexedFactStorage: deleteFact dispatches deletion patch", async () => {
  const inner = new InMemoryFactStorage();
  const spy = new SpyPatchHandler();
  const storage = new IndexedFactStorage(inner, [spy]);

  const fact = makeFact();
  await storage.setFact(fact);
  spy.patches = []; // reset

  await storage.deleteFact(fact);

  assertEquals(spy.patches.length, 1);
  assertEquals(spy.patches[0][0].insertions.length, 0);
  assertEquals(spy.patches[0][0].deletions.length, 1);
  assertEquals(spy.patches[0][0].deletions[0], fact);
});

Deno.test("IndexedFactStorage: setFacts dispatches batch insertion patch", async () => {
  const inner = new InMemoryFactStorage();
  const spy = new SpyPatchHandler();
  const storage = new IndexedFactStorage(inner, [spy]);

  const facts = [
    makeFact({ subject: "https://example.org/a" }),
    makeFact({ subject: "https://example.org/b" }),
  ];
  await storage.setFacts(facts);

  assertEquals(spy.patches.length, 1);
  assertEquals(spy.patches[0][0].insertions.length, 2);
});

Deno.test("IndexedFactStorage: setFacts with empty array is no-op", async () => {
  const inner = new InMemoryFactStorage();
  const spy = new SpyPatchHandler();
  const storage = new IndexedFactStorage(inner, [spy]);

  await storage.setFacts([]);

  assertEquals(spy.patches.length, 0);
});

Deno.test("IndexedFactStorage: deleteFacts dispatches batch deletion patch", async () => {
  const inner = new InMemoryFactStorage();
  const spy = new SpyPatchHandler();
  const storage = new IndexedFactStorage(inner, [spy]);

  const facts = [
    makeFact({ subject: "https://example.org/a" }),
    makeFact({ subject: "https://example.org/b" }),
  ];
  await storage.setFacts(facts);
  spy.patches = [];

  await storage.deleteFacts(facts);

  assertEquals(spy.patches.length, 1);
  assertEquals(spy.patches[0][0].deletions.length, 2);
});

Deno.test("IndexedFactStorage: deleteFacts with empty array is no-op", async () => {
  const inner = new InMemoryFactStorage();
  const spy = new SpyPatchHandler();
  const storage = new IndexedFactStorage(inner, [spy]);

  await storage.deleteFacts([]);

  assertEquals(spy.patches.length, 0);
});

Deno.test("IndexedFactStorage: clear dispatches deletion patch for all existing facts", async () => {
  const inner = new InMemoryFactStorage();
  const spy = new SpyPatchHandler();
  const storage = new IndexedFactStorage(inner, [spy]);

  await storage.setFacts([
    makeFact({ subject: "https://example.org/a" }),
    makeFact({ subject: "https://example.org/b" }),
  ]);
  spy.patches = [];

  await storage.clear();

  assertEquals(spy.patches.length, 1);
  assertEquals(spy.patches[0][0].deletions.length, 2);
  assertEquals(spy.patches[0][0].insertions.length, 0);

  // Inner should be empty
  const results = await inner.findFacts([]);
  assertEquals(results.length, 0);
});

Deno.test("IndexedFactStorage: clear on empty store does not dispatch", async () => {
  const inner = new InMemoryFactStorage();
  const spy = new SpyPatchHandler();
  const storage = new IndexedFactStorage(inner, [spy]);

  await storage.clear();

  assertEquals(spy.patches.length, 0);
});

Deno.test("IndexedFactStorage: findFacts delegates to inner", async () => {
  const inner = new InMemoryFactStorage();
  const spy = new SpyPatchHandler();
  const storage = new IndexedFactStorage(inner, [spy]);

  await storage.setFact(makeFact({ subject: "https://example.org/a" }));
  await storage.setFact(makeFact({ subject: "https://example.org/b" }));

  const all = await storage.findFacts([]);
  assertEquals(all.length, 2);

  // findFacts should NOT dispatch any patches
  assertEquals(spy.patches.length, 2); // only the 2 setFact calls
});

Deno.test("IndexedFactStorage: dispatches to multiple handlers", async () => {
  const inner = new InMemoryFactStorage();
  const spy1 = new SpyPatchHandler();
  const spy2 = new SpyPatchHandler();
  const storage = new IndexedFactStorage(inner, [spy1, spy2]);

  await storage.setFact(makeFact());

  assertEquals(spy1.patches.length, 1);
  assertEquals(spy2.patches.length, 1);
});
