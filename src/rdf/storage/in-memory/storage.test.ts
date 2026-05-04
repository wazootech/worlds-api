import { assertEquals } from "@std/assert";
import type { StoredQuad } from "#/rdf/storage/types.ts";
import { InMemoryQuadStorage } from "./storage.ts";

Deno.test("InMemoryQuadStorage: setQuad stores and findQuads retrieves", async () => {
  const s = new InMemoryQuadStorage();
  const quad: StoredQuad = {
    subject: "s",
    predicate: "p",
    object: "o",
    graph: "g",
  };
  await s.setQuad(quad);
  const results = await s.findQuads([]);
  assertEquals(results.length, 1);
  assertEquals(results[0], quad);
});

Deno.test("InMemoryQuadStorage: setQuad is idempotent (dedup by key)", async () => {
  const s = new InMemoryQuadStorage();
  const quad: StoredQuad = {
    subject: "s",
    predicate: "p",
    object: "o",
    graph: "g",
  };
  await s.setQuad(quad);
  await s.setQuad(quad);
  const results = await s.findQuads([]);
  assertEquals(results.length, 1);
});

Deno.test("InMemoryQuadStorage: setQuads batch stores multiple", async () => {
  const s = new InMemoryQuadStorage();
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
  const results = await s.findQuads([]);
  assertEquals(results.length, 2);
});

Deno.test("InMemoryQuadStorage: deleteQuad removes quad", async () => {
  const s = new InMemoryQuadStorage();
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
});

Deno.test("InMemoryQuadStorage: deleteQuad is idempotent (no-op for missing)", async () => {
  const s = new InMemoryQuadStorage();
  const quad: StoredQuad = {
    subject: "s",
    predicate: "p",
    object: "o",
    graph: "g",
  };
  await s.deleteQuad(quad);
  const results = await s.findQuads([]);
  assertEquals(results.length, 0);
});

Deno.test("InMemoryQuadStorage: deleteQuads batch removes multiple", async () => {
  const s = new InMemoryQuadStorage();
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
  await s.deleteQuads([q1]);
  const results = await s.findQuads([]);
  assertEquals(results.length, 1);
  assertEquals(results[0].subject, "s2");
});

Deno.test("InMemoryQuadStorage: findQuads with matchers filters correctly", async () => {
  const s = new InMemoryQuadStorage();
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

Deno.test("InMemoryQuadStorage: clear removes all quads", async () => {
  const s = new InMemoryQuadStorage();
  const quad: StoredQuad = {
    subject: "s",
    predicate: "p",
    object: "o",
    graph: "g",
  };
  await s.setQuad(quad);
  await s.clear();
  const results = await s.findQuads([]);
  assertEquals(results.length, 0);
});

Deno.test("InMemoryQuadStorage: clear is idempotent", async () => {
  const s = new InMemoryQuadStorage();
  await s.clear();
  await s.clear();
  const results = await s.findQuads([]);
  assertEquals(results.length, 0);
});
