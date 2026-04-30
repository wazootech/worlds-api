import { assertEquals } from "@std/assert";
import { InMemoryQuadStorage } from "./in-memory-quad-storage.ts";
import type { StoredQuad } from "./quad.ts";

function makeFact(overrides: Partial<StoredQuad> = {}): StoredQuad {
  return {
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    object: "hello",
    graph: "",
    ...overrides,
  };
}

// --- findFacts with partial matchers ---

Deno.test("InMemoryQuadStorage: findQuads with empty matcher returns all", async () => {
  const storage = new InMemoryQuadStorage();
  await storage.setQuad(makeFact({ subject: "https://example.org/a" }));
  await storage.setQuad(makeFact({ subject: "https://example.org/b" }));

  const results = await storage.findQuads([]);
  assertEquals(results.length, 2);
});

Deno.test("InMemoryQuadStorage: findQuads filters by subject", async () => {
  const storage = new InMemoryQuadStorage();
  await storage.setQuad(makeFact({ subject: "https://example.org/alice" }));
  await storage.setQuad(makeFact({ subject: "https://example.org/bob" }));

  const results = await storage.findQuads([{
    subject: "https://example.org/alice",
    predicate: "",
    object: "",
    graph: "",
  }]);
  assertEquals(results.length, 1);
  assertEquals(results[0].subject, "https://example.org/alice");
});

Deno.test("InMemoryQuadStorage: findQuads filters by predicate", async () => {
  const storage = new InMemoryQuadStorage();
  await storage.setQuad(makeFact({ predicate: "https://example.org/name" }));
  await storage.setQuad(
    makeFact({
      predicate: "https://example.org/age",
      subject: "https://example.org/s2",
    }),
  );

  const results = await storage.findQuads([{
    subject: "",
    predicate: "https://example.org/name",
    object: "",
    graph: "",
  }]);
  assertEquals(results.length, 1);
  assertEquals(results[0].predicate, "https://example.org/name");
});

Deno.test("InMemoryQuadStorage: findQuads filters by graph", async () => {
  const storage = new InMemoryQuadStorage();
  await storage.setQuad(makeFact({ graph: "g1" }));
  await storage.setQuad(
    makeFact({ graph: "g2", subject: "https://example.org/s2" }),
  );

  const results = await storage.findQuads([{
    subject: "",
    predicate: "",
    object: "",
    graph: "g1",
  }]);
  assertEquals(results.length, 1);
  assertEquals(results[0].graph, "g1");
});

Deno.test("InMemoryQuadStorage: deleteQuad removes the correct quad", async () => {
  const storage = new InMemoryQuadStorage();
  const f1 = makeFact({ subject: "https://example.org/a" });
  const f2 = makeFact({ subject: "https://example.org/b" });
  await storage.setQuads([f1, f2]);

  await storage.deleteQuad(f1);

  const results = await storage.findQuads([]);
  assertEquals(results.length, 1);
  assertEquals(results[0].subject, "https://example.org/b");
});

Deno.test("InMemoryQuadStorage: deleteQuads removes multiple", async () => {
  const storage = new InMemoryQuadStorage();
  const f1 = makeFact({ subject: "https://example.org/a" });
  const f2 = makeFact({ subject: "https://example.org/b" });
  const f3 = makeFact({ subject: "https://example.org/c" });
  await storage.setQuads([f1, f2, f3]);

  await storage.deleteQuads([f1, f3]);

  const results = await storage.findQuads([]);
  assertEquals(results.length, 1);
  assertEquals(results[0].subject, "https://example.org/b");
});

Deno.test("InMemoryQuadStorage: clear empties the store", async () => {
  const storage = new InMemoryQuadStorage();
  await storage.setQuads([
    makeFact({ subject: "https://example.org/a" }),
    makeFact({ subject: "https://example.org/b" }),
  ]);

  await storage.clear();

  const results = await storage.findQuads([]);
  assertEquals(results.length, 0);
});

Deno.test("InMemoryQuadStorage: setQuad overwrites duplicate key", async () => {
  const storage = new InMemoryQuadStorage();
  const f1 = makeFact({ object: "old" });
  await storage.setQuad(f1);
  // Same s/p/g key, different object — but storedQuadKey likely uses s+p+o+g so this would be a different key
  // Let's test exact same key:
  await storage.setQuad(f1);

  const results = await storage.findQuads([]);
  assertEquals(results.length, 1);
});
