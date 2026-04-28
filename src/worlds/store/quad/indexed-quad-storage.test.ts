import { assertEquals, assertRejects } from "@std/assert";
import { InMemoryQuadStorage } from "./in-memory.ts";
import { IndexedQuadStorage } from "./indexed-quad-storage.ts";
import type { Patch, PatchHandler } from "#/worlds/index/patch/types.ts";
import type { StoredQuad } from "./types.ts";

const SAMPLE_QUAD: StoredQuad = {
  subject: "https://example.org/s",
  predicate: "https://example.org/p",
  object: "https://example.org/o",
  graph: "https://example.org/g",
};

class MockPatchHandler implements PatchHandler {
  patches: Patch[] = [];
  error: Error | null = null;

  async patch(patches: Patch[]): Promise<void> {
    if (this.error) throw this.error;
    this.patches.push(...patches);
  }
}

Deno.test("IndexedQuadStorage: setQuad emits patch with insertions", async () => {
  const inner = new InMemoryQuadStorage();
  const handler = new MockPatchHandler();
  const storage = new IndexedQuadStorage(inner, [handler]);

  await storage.setQuad(SAMPLE_QUAD);

  const results = await inner.findQuads([]);
  assertEquals(results.length, 1);
  assertEquals(handler.patches.length, 1);
  assertEquals(handler.patches[0].insertions.length, 1);
  assertEquals(handler.patches[0].deletions.length, 0);
});

Deno.test("IndexedQuadStorage: deleteQuad emits patch with deletions", async () => {
  const inner = new InMemoryQuadStorage();
  await inner.setQuad(SAMPLE_QUAD);
  const handler = new MockPatchHandler();
  const storage = new IndexedQuadStorage(inner, [handler]);

  await storage.deleteQuad(SAMPLE_QUAD);

  const results = await inner.findQuads([]);
  assertEquals(results.length, 0);
  assertEquals(handler.patches.length, 1);
  assertEquals(handler.patches[0].insertions.length, 0);
  assertEquals(handler.patches[0].deletions.length, 1);
});

Deno.test("IndexedQuadStorage: clear emits patch with existing as deletions", async () => {
  const inner = new InMemoryQuadStorage();
  await inner.setQuad(SAMPLE_QUAD);
  const handler = new MockPatchHandler();
  const storage = new IndexedQuadStorage(inner, [handler]);

  await storage.clear();

  const results = await inner.findQuads([]);
  assertEquals(results.length, 0);
  assertEquals(handler.patches.length, 1);
  assertEquals(handler.patches[0].deletions.length, 1);
});

Deno.test("IndexedQuadStorage: empty add does not emit patch", async () => {
  const inner = new InMemoryQuadStorage();
  const handler = new MockPatchHandler();
  const storage = new IndexedQuadStorage(inner, [handler]);

  await storage.setQuad(SAMPLE_QUAD);
  await storage.deleteQuad(SAMPLE_QUAD);

  assertEquals(handler.patches.length, 2);
});

Deno.test("IndexedQuadStorage: queries inner storage", async () => {
  const inner = new InMemoryQuadStorage();
  await inner.setQuad(SAMPLE_QUAD);
  const handler = new MockPatchHandler();
  const storage = new IndexedQuadStorage(inner, [handler]);

  const results = await storage.findQuads([]);

  assertEquals(results.length, 1);
  assertEquals(results[0].subject, SAMPLE_QUAD.subject);
});

Deno.test("IndexedQuadStorage: handler errors propagate", async () => {
  const inner = new InMemoryQuadStorage();
  const handler = new MockPatchHandler();
  handler.error = new Error("handler failed");
  const storage = new IndexedQuadStorage(inner, [handler]);

  await assertRejects(
    () => storage.setQuad(SAMPLE_QUAD),
    Error,
    "handler failed",
  );
});

Deno.test("IndexedQuadStorage: multiple handlers receive patches", async () => {
  const inner = new InMemoryQuadStorage();
  const handler1 = new MockPatchHandler();
  const handler2 = new MockPatchHandler();
  const storage = new IndexedQuadStorage(inner, [handler1, handler2]);

  await storage.setQuad(SAMPLE_QUAD);

  assertEquals(handler1.patches.length, 1);
  assertEquals(handler2.patches.length, 1);
});
