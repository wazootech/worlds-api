import { assertEquals } from "@std/assert";
import type { StoredQuad } from "./types.ts";
import { InMemoryQuadStorage } from "./in-memory.ts";

const SAMPLE_QUAD: StoredQuad = {
  subject: "https://example.org/s",
  predicate: "https://example.org/p",
  object: "https://example.org/o",
  graph: "https://example.org/g",
};

Deno.test("InMemoryQuadStorage: setQuad stores quad", async () => {
  const storage = new InMemoryQuadStorage();
  await storage.setQuad(SAMPLE_QUAD);

  const results = await storage.findQuads([]);
  assertEquals(results.length, 1);
  assertEquals(results[0].subject, SAMPLE_QUAD.subject);
});

Deno.test("InMemoryQuadStorage: setQuad ignores duplicates", async () => {
  const storage = new InMemoryQuadStorage();
  await storage.setQuad(SAMPLE_QUAD);
  await storage.setQuad(SAMPLE_QUAD);

  const results = await storage.findQuads([]);
  assertEquals(results.length, 1);
});

Deno.test("InMemoryQuadStorage: deleteQuad deletes quad", async () => {
  const storage = new InMemoryQuadStorage();
  await storage.setQuad(SAMPLE_QUAD);
  await storage.deleteQuad(SAMPLE_QUAD);

  const results = await storage.findQuads([]);
  assertEquals(results.length, 0);
});

Deno.test("InMemoryQuadStorage: findQuads with no matchers returns all", async () => {
  const storage = new InMemoryQuadStorage();
  await storage.setQuad({
    subject: "s1",
    predicate: "p",
    object: "o1",
    graph: "g",
  });
  await storage.setQuad({
    subject: "s2",
    predicate: "p",
    object: "o2",
    graph: "g",
  });

  const results = await storage.findQuads([]);
  assertEquals(results.length, 2);
});

Deno.test("InMemoryQuadStorage: findQuads matches by subject", async () => {
  const storage = new InMemoryQuadStorage();
  await storage.setQuad({
    subject: "s1",
    predicate: "p",
    object: "o1",
    graph: "g",
  });
  await storage.setQuad({
    subject: "s2",
    predicate: "p",
    object: "o2",
    graph: "g",
  });

  const results = await storage.findQuads([{
    subject: "s1",
    predicate: "",
    object: "",
    graph: "",
  }]);
  assertEquals(results.length, 1);
  assertEquals(results[0].subject, "s1");
});

Deno.test("InMemoryQuadStorage: findQuads matches by predicate", async () => {
  const storage = new InMemoryQuadStorage();
  await storage.setQuad({
    subject: "s",
    predicate: "p1",
    object: "o",
    graph: "g",
  });
  await storage.setQuad({
    subject: "s",
    predicate: "p2",
    object: "o",
    graph: "g",
  });

  const results = await storage.findQuads([{
    subject: "",
    predicate: "p1",
    object: "",
    graph: "",
  }]);
  assertEquals(results.length, 1);
  assertEquals(results[0].predicate, "p1");
});

Deno.test("InMemoryQuadStorage: findQuads matches by object", async () => {
  const storage = new InMemoryQuadStorage();
  await storage.setQuad({
    subject: "s",
    predicate: "p",
    object: "o1",
    graph: "g",
  });
  await storage.setQuad({
    subject: "s",
    predicate: "p",
    object: "o2",
    graph: "g",
  });

  const results = await storage.findQuads([{
    subject: "",
    predicate: "",
    object: "o1",
    graph: "",
  }]);
  assertEquals(results.length, 1);
  assertEquals(results[0].object, "o1");
});

Deno.test("InMemoryQuadStorage: findQuads matches by graph", async () => {
  const storage = new InMemoryQuadStorage();
  await storage.setQuad({
    subject: "s",
    predicate: "p",
    object: "o",
    graph: "g1",
  });
  await storage.setQuad({
    subject: "s",
    predicate: "p",
    object: "o",
    graph: "g2",
  });

  const results = await storage.findQuads([{
    subject: "",
    predicate: "",
    object: "",
    graph: "g1",
  }]);
  assertEquals(results.length, 1);
  assertEquals(results[0].graph, "g1");
});

Deno.test("InMemoryQuadStorage: findQuads matches with multiple conditions", async () => {
  const storage = new InMemoryQuadStorage();
  await storage.setQuad({
    subject: "s1",
    predicate: "p1",
    object: "o1",
    graph: "g",
  });
  await storage.setQuad({
    subject: "s1",
    predicate: "p1",
    object: "o2",
    graph: "g",
  });

  const results = await storage.findQuads([
    { subject: "s1", predicate: "p1", object: "", graph: "" },
  ]);
  assertEquals(results.length, 2);
});

Deno.test("InMemoryQuadStorage: clear removes all quads", async () => {
  const storage = new InMemoryQuadStorage();
  await storage.setQuad(SAMPLE_QUAD);
  await storage.clear();

  const results = await storage.findQuads([]);
  assertEquals(results.length, 0);
});

Deno.test("InMemoryQuadStorage: handles objectTermType for key collision", async () => {
  const storage = new InMemoryQuadStorage();
  const namedNode: StoredQuad = {
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    object: "https://example.org/o",
    graph: "",
    objectTermType: "NamedNode",
  };
  const literal: StoredQuad = {
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    object: "https://example.org/o",
    graph: "",
    objectTermType: "Literal",
  };

  await storage.setQuad(namedNode);
  await storage.setQuad(literal);

  const results = await storage.findQuads([]);
  assertEquals(results.length, 2);
});

Deno.test("InMemoryQuadStorage: handles objectDatatype for key collision", async () => {
  const storage = new InMemoryQuadStorage();
  const withDatatype: StoredQuad = {
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    object: "2024-01-01",
    graph: "",
    objectTermType: "Literal",
    objectDatatype: "http://www.w3.org/2001/XMLSchema#date",
  };
  const withoutDatatype: StoredQuad = {
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    object: "2024-01-01",
    graph: "",
  };

  await storage.setQuad(withDatatype);
  await storage.setQuad(withoutDatatype);

  const results = await storage.findQuads([]);
  assertEquals(results.length, 2);
});

Deno.test("InMemoryQuadStorage: handles objectLanguage for key collision", async () => {
  const storage = new InMemoryQuadStorage();
  const en: StoredQuad = {
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    object: "Hello",
    graph: "",
    objectTermType: "Literal",
    objectLanguage: "en",
  };
  const fr: StoredQuad = {
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    object: "Hello",
    graph: "",
    objectTermType: "Literal",
    objectLanguage: "fr",
  };

  await storage.setQuad(en);
  await storage.setQuad(fr);

  const results = await storage.findQuads([]);
  assertEquals(results.length, 2);
});
