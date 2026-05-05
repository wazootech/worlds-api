import { assertEquals } from "@std/assert";
import { searchNaiveFts } from "./search-naive-fts.ts";
import { InMemoryQuadStorageManager } from "#/rdf/storage/in-memory/manager.ts";
import { InMemoryWorldStorage } from "./storage/in-memory.ts";

Deno.test("searchNaiveFts: supports subjects, predicates, and types filtering", async () => {
  const quadStorageManager = new InMemoryQuadStorageManager();
  const worldStorage = new InMemoryWorldStorage();
  const worldRef = { namespace: "ns", id: "w1" };

  await worldStorage.createWorld({
    reference: worldRef,
    displayName: "W1",
    createTime: Date.now(),
  });

  const quadStorage = await quadStorageManager.getQuadStorage(worldRef);
  await quadStorage.setQuads([
    {
      subject: "s1",
      predicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      object: "TypeA",
      graph: "",
    },
    {
      subject: "s1",
      predicate: "p1",
      object: "Target text",
      graph: "",
    },
    {
      subject: "s2",
      predicate: "p1",
      object: "Target text",
      graph: "",
    },
  ]);

  // 1. Search without filters
  let results = await searchNaiveFts({
    targetRefs: [worldRef],
    queryTerms: ["target"],
    queryText: "target",
    quadStorageManager,
    worldStorage,
  });
  assertEquals(results.length, 2);

  // 2. Filter by subject
  results = await searchNaiveFts({
    targetRefs: [worldRef],
    queryTerms: ["target"],
    queryText: "target",
    subjects: ["s1"],
    quadStorageManager,
    worldStorage,
  });
  assertEquals(results.length, 1);
  assertEquals(results[0].subject, "s1");

  // 3. Filter by type
  results = await searchNaiveFts({
    targetRefs: [worldRef],
    queryTerms: ["target"],
    queryText: "target",
    types: ["TypeA"],
    quadStorageManager,
    worldStorage,
  });
  assertEquals(results.length, 1);
  assertEquals(results[0].subject, "s1");

  // 4. Filter by non-existent type
  results = await searchNaiveFts({
    targetRefs: [worldRef],
    queryTerms: ["target"],
    queryText: "target",
    types: ["TypeB"],
    quadStorageManager,
    worldStorage,
  });
  assertEquals(results.length, 0);
});

Deno.test("searchNaiveFts: supports phrase matching without keyword match", async () => {
  const quadStorageManager = new InMemoryQuadStorageManager();
  const worldStorage = new InMemoryWorldStorage();
  const worldRef = { namespace: "ns", id: "w1" };

  const quadStorage = await quadStorageManager.getQuadStorage(worldRef);
  await quadStorage.setQuads([
    {
      subject: "s1",
      predicate: "p1",
      object: "The quick brown fox",
      graph: "",
    },
  ]);

  // queryTerms empty, but queryText matches phrase
  const results = await searchNaiveFts({
    targetRefs: [worldRef],
    queryTerms: [],
    queryText: "quick brown",
    quadStorageManager,
    worldStorage,
  });
  assertEquals(results.length, 1);
  assertEquals(results[0].score, 0); // Phrase match only = score 0
});
