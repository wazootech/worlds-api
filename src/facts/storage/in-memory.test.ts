import { assertEquals } from "@std/assert";
import { InMemoryFactStorage } from "./in-memory.ts";
import type { StoredFact } from "./types.ts";

function makeFact(overrides: Partial<StoredFact> = {}): StoredFact {
  return {
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    object: "hello",
    graph: "",
    ...overrides,
  };
}

// --- findFacts with partial matchers ---

Deno.test("InMemoryFactStorage: findFacts with empty matcher returns all", async () => {
  const storage = new InMemoryFactStorage();
  await storage.setFact(makeFact({ subject: "https://example.org/a" }));
  await storage.setFact(makeFact({ subject: "https://example.org/b" }));

  const results = await storage.findFacts([]);
  assertEquals(results.length, 2);
});

Deno.test("InMemoryFactStorage: findFacts filters by subject", async () => {
  const storage = new InMemoryFactStorage();
  await storage.setFact(makeFact({ subject: "https://example.org/alice" }));
  await storage.setFact(makeFact({ subject: "https://example.org/bob" }));

  const results = await storage.findFacts([{ subject: "https://example.org/alice", predicate: "", object: "", graph: "" }]);
  assertEquals(results.length, 1);
  assertEquals(results[0].subject, "https://example.org/alice");
});

Deno.test("InMemoryFactStorage: findFacts filters by predicate", async () => {
  const storage = new InMemoryFactStorage();
  await storage.setFact(makeFact({ predicate: "https://example.org/name" }));
  await storage.setFact(makeFact({ predicate: "https://example.org/age", subject: "https://example.org/s2" }));

  const results = await storage.findFacts([{ subject: "", predicate: "https://example.org/name", object: "", graph: "" }]);
  assertEquals(results.length, 1);
  assertEquals(results[0].predicate, "https://example.org/name");
});

Deno.test("InMemoryFactStorage: findFacts filters by graph", async () => {
  const storage = new InMemoryFactStorage();
  await storage.setFact(makeFact({ graph: "g1" }));
  await storage.setFact(makeFact({ graph: "g2", subject: "https://example.org/s2" }));

  const results = await storage.findFacts([{ subject: "", predicate: "", object: "", graph: "g1" }]);
  assertEquals(results.length, 1);
  assertEquals(results[0].graph, "g1");
});

Deno.test("InMemoryFactStorage: deleteFact removes the correct fact", async () => {
  const storage = new InMemoryFactStorage();
  const f1 = makeFact({ subject: "https://example.org/a" });
  const f2 = makeFact({ subject: "https://example.org/b" });
  await storage.setFacts([f1, f2]);

  await storage.deleteFact(f1);

  const results = await storage.findFacts([]);
  assertEquals(results.length, 1);
  assertEquals(results[0].subject, "https://example.org/b");
});

Deno.test("InMemoryFactStorage: deleteFacts removes multiple", async () => {
  const storage = new InMemoryFactStorage();
  const f1 = makeFact({ subject: "https://example.org/a" });
  const f2 = makeFact({ subject: "https://example.org/b" });
  const f3 = makeFact({ subject: "https://example.org/c" });
  await storage.setFacts([f1, f2, f3]);

  await storage.deleteFacts([f1, f3]);

  const results = await storage.findFacts([]);
  assertEquals(results.length, 1);
  assertEquals(results[0].subject, "https://example.org/b");
});

Deno.test("InMemoryFactStorage: clear empties the store", async () => {
  const storage = new InMemoryFactStorage();
  await storage.setFacts([
    makeFact({ subject: "https://example.org/a" }),
    makeFact({ subject: "https://example.org/b" }),
  ]);

  await storage.clear();

  const results = await storage.findFacts([]);
  assertEquals(results.length, 0);
});

Deno.test("InMemoryFactStorage: setFact overwrites duplicate key", async () => {
  const storage = new InMemoryFactStorage();
  const f1 = makeFact({ object: "old" });
  await storage.setFact(f1);
  // Same s/p/g key, different object — but storedFactKey likely uses s+p+o+g so this would be a different key
  // Let's test exact same key:
  await storage.setFact(f1);

  const results = await storage.findFacts([]);
  assertEquals(results.length, 1);
});
