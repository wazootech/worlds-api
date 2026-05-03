import { assertEquals, assertRejects } from "@std/assert";
import { FakeEmbeddingsService } from "#/indexing/embeddings/fake.ts";
import { InMemoryChunkIndexManager } from "#/indexing/storage/in-memory.ts";
import { Worlds } from "./worlds.ts";
import { InMemoryWorldStorage } from "#/core/storage/in-memory.ts";
import { IndexedQuadStorageManager } from "#/rdf/storage/indexed-quad-storage-manager.ts";
import { InMemoryQuadStorageManager } from "#/rdf/storage/in-memory-quad-storage-manager.ts";
import {
  InvalidArgumentError,
  InvalidPageTokenError,
  WorldAlreadyExistsError,
  WorldNotFoundError,
} from "#/core/errors.ts";

function createWorlds(userId: string = "test-user") {
  const chunkIndexManager = new InMemoryChunkIndexManager();
  const embeddings = new FakeEmbeddingsService();
  return new Worlds({
    worldStorage: new InMemoryWorldStorage(),
    quadStorageManager: new IndexedQuadStorageManager(
      embeddings,
      chunkIndexManager,
    ),
    chunkIndexManager,
    embeddings,
  }, userId);
}

function createWorldsWithSharedOptions(userId: string = "test-user") {
  const worldStorage = new InMemoryWorldStorage();
  const chunkIndexManager = new InMemoryChunkIndexManager();
  const embeddings = new FakeEmbeddingsService();
  const storeStorage = new IndexedQuadStorageManager(
    embeddings,
    chunkIndexManager,
  );
  const worlds = new Worlds({
    worldStorage,
    quadStorageManager: storeStorage,
    chunkIndexManager,
    embeddings,
  }, userId);
  return { worlds, chunkIndexManager };
}

function createWorldsWithInMemoryQuadStorage(userId: string = "test-user") {
  return new Worlds({
    worldStorage: new InMemoryWorldStorage(),
    quadStorageManager: new InMemoryQuadStorageManager(),
  }, userId);
}

Deno.test("Worlds: create/get/update/delete world", async () => {
  const worlds = createWorlds();

  const created = await worlds.createWorld({
    namespace: "ns",
    id: "w1",
    displayName: "World 1",
    description: "desc",
  });
  assertEquals(created.name, "ns/w1");
  assertEquals(created.namespace, "ns");
  assertEquals(created.id, "w1");
  assertEquals(created.displayName, "World 1");

  const fetched = await worlds.getWorld({ source: "ns/w1" });
  assertEquals(fetched?.name, "ns/w1");

  const updated = await worlds.updateWorld({
    source: { namespace: "ns", id: "w1" },
    displayName: "World One",
  });
  assertEquals(updated.displayName, "World One");
  assertEquals(updated.description, "desc");

  await worlds.deleteWorld({ source: "ns/w1" });
  const afterDelete = await worlds.getWorld({ source: "ns/w1" });
  assertEquals(afterDelete, null);
});

Deno.test("Worlds: createWorld rejects duplicates", async () => {
  const worlds = createWorlds();
  await worlds.createWorld({ namespace: "ns", id: "w1" });
  await assertRejects(
    () => worlds.createWorld({ namespace: "ns", id: "w1" }),
    WorldAlreadyExistsError,
  );
});

Deno.test("Worlds: listWorlds paginates with opaque tokens", async () => {
  const worlds = createWorlds();

  await worlds.createWorld({ namespace: "a", id: "w1" });
  await worlds.createWorld({ namespace: "a", id: "w2" });
  await worlds.createWorld({ namespace: "a", id: "w3" });

  const first = await worlds.listWorlds({ parent: "a", pageSize: 2 });
  assertEquals(first.worlds.length, 2);
  assertEquals(typeof first.nextPageToken, "string");

  const second = await worlds.listWorlds({
    parent: "a",
    pageSize: 2,
    pageToken: first.nextPageToken,
  });
  assertEquals(second.worlds.length, 1);
  assertEquals(second.nextPageToken, undefined);

  // Token is bound to request params (parent); mismatch should reject.
  await assertRejects(
    () =>
      worlds.listWorlds({
        parent: "b",
        pageSize: 2,
        pageToken: first.nextPageToken,
      }),
    InvalidPageTokenError,
  );
});

Deno.test("Worlds: sparql SELECT query on world", async () => {
  const worlds = createWorlds();

  await worlds.createWorld({
    namespace: "ns",
    id: "sparqlTest",
    displayName: "SPARQL Test",
  });

  const nquads =
    `<https://example.com/s> <https://example.com/p> <https://example.com/o1> .\n` +
    `<https://example.com/s> <https://example.com/p> <https://example.com/o2> .`;

  await worlds.import({
    source: "ns/sparqlTest",
    data: nquads,
    contentType: "application/n-quads",
  });

  const result = await worlds.sparql({
    sources: ["ns/sparqlTest"],
    query:
      "SELECT ?o WHERE { <https://example.com/s> <https://example.com/p> ?o } ORDER BY ?o",
  });

  const rows = result as {
    results: { bindings: Array<{ o?: { value: string } }> };
  };
  assertEquals(rows.results.bindings.length, 2);
  assertEquals(rows.results.bindings[0].o?.value, "https://example.com/o1");
  assertEquals(rows.results.bindings[1].o?.value, "https://example.com/o2");
});

Deno.test("Worlds: sparql ASK query returns true", async () => {
  const worlds = createWorlds();

  await worlds.createWorld({
    namespace: "ns",
    id: "askTest",
    displayName: "ASK Test",
  });

  await worlds.import({
    source: "ns/askTest",
    data:
      `<https://example.com/s> <https://example.com/p> <https://example.com/o> .`,
    contentType: "application/n-quads",
  });

  const result = await worlds.sparql({
    sources: ["ns/askTest"],
    query:
      "ASK { <https://example.com/s> <https://example.com/p> <https://example.com/o> }",
  });

  assertEquals((result as { boolean: boolean }).boolean, true);
});

Deno.test("Worlds: sparql ASK query returns false", async () => {
  const worlds = createWorlds();

  await worlds.createWorld({
    namespace: "ns",
    id: "askTest2",
    displayName: "ASK Test 2",
  });

  await worlds.import({
    source: "ns/askTest2",
    data:
      `<https://example.com/s> <https://example.com/p> <https://example.com/o> .`,
    contentType: "application/n-quads",
  });

  const result = await worlds.sparql({
    sources: ["ns/askTest2"],
    query:
      "ASK { <https://example.com/s> <https://example.com/p> <https://example.com/o2> }",
  });

  assertEquals((result as { boolean: boolean }).boolean, false);
});

Deno.test("Worlds: sparql UPDATE INSERT adds triples", async () => {
  const worlds = createWorlds();

  await worlds.createWorld({
    namespace: "ns",
    id: "updateTest",
    displayName: "UPDATE Test",
  });

  // Insert a triple using SPARQL UPDATE
  await worlds.sparql({
    sources: ["ns/updateTest"],
    query:
      `INSERT DATA { <https://example.com/s> <https://example.com/p> <https://example.com/o1> }`,
  });

  // Verify the triple was added
  const result = await worlds.sparql({
    sources: ["ns/updateTest"],
    query:
      "SELECT ?o WHERE { <https://example.com/s> <https://example.com/p> ?o }",
  });

  const rows = result as {
    results: { bindings: Array<{ o?: { value: string } }> };
  };
  assertEquals(rows.results.bindings.length, 1);
  assertEquals(rows.results.bindings[0].o?.value, "https://example.com/o1");
});

Deno.test("Worlds: sparql UPDATE DELETE removes triples", async () => {
  const worlds = createWorlds();

  await worlds.createWorld({
    namespace: "ns",
    id: "deleteTest",
    displayName: "DELETE Test",
  });

  // First insert some data
  await worlds.import({
    source: "ns/deleteTest",
    data:
      `<https://example.com/s> <https://example.com/p> <https://example.com/o1> .\n` +
      `<https://example.com/s> <https://example.com/p> <https://example.com/o2> .`,
    contentType: "application/n-quads",
  });

  // Verify we have 2 triples
  let result = await worlds.sparql({
    sources: ["ns/deleteTest"],
    query:
      "SELECT ?o WHERE { <https://example.com/s> <https://example.com/p> ?o } ORDER BY ?o",
  });

  let rows = result as {
    results: { bindings: Array<{ o?: { value: string } }> };
  };
  assertEquals(rows.results.bindings.length, 2);

  // Delete one triple
  await worlds.sparql({
    sources: ["ns/deleteTest"],
    query:
      `DELETE DATA { <https://example.com/s> <https://example.com/p> <https://example.com/o1> }`,
  });

  // Verify only one remains
  result = await worlds.sparql({
    sources: ["ns/deleteTest"],
    query:
      "SELECT ?o WHERE { <https://example.com/s> <https://example.com/p> ?o } ORDER BY ?o",
  });

  rows = result as { results: { bindings: Array<{ o?: { value: string } }> } };
  assertEquals(rows.results.bindings.length, 1);
  assertEquals(rows.results.bindings[0].o?.value, "https://example.com/o2");
});

Deno.test("Worlds: sparql UPDATE INSERT+DELETE combination", async () => {
  const worlds = createWorlds();

  await worlds.createWorld({
    namespace: "ns",
    id: "comboTest",
    displayName: "Combo Test",
  });

  // Insert initial data
  await worlds.import({
    source: "ns/comboTest",
    data:
      `<https://example.com/s> <https://example.com/p> <https://example.com/o1> .`,
    contentType: "application/n-quads",
  });

  // Replace o1 with o2 using INSERT+DELETE
  await worlds.sparql({
    sources: ["ns/comboTest"],
    query: `
      DELETE { <https://example.com/s> <https://example.com/p> <https://example.com/o1> }
      INSERT { <https://example.com/s> <https://example.com/p> <https://example.com/o2> }
      WHERE { <https://example.com/s> <https://example.com/p> <https://example.com/o1> }
    `,
  });

  const result = await worlds.sparql({
    sources: ["ns/comboTest"],
    query:
      "SELECT ?o WHERE { <https://example.com/s> <https://example.com/p> ?o }",
  });

  const rows = result as {
    results: { bindings: Array<{ o?: { value: string } }> };
  };
  assertEquals(rows.results.bindings.length, 1);
  assertEquals(rows.results.bindings[0].o?.value, "https://example.com/o2");
});

Deno.test("Worlds: multi-source sparql query unions multiple worlds", async () => {
  const worlds = createWorlds();

  // Create two worlds
  await worlds.createWorld({
    namespace: "ns",
    id: "world1",
    displayName: "World 1",
  });
  await worlds.createWorld({
    namespace: "ns",
    id: "world2",
    displayName: "World 2",
  });

  // Add different data to each world
  await worlds.import({
    source: "ns/world1",
    data:
      `<https://example.com/s> <https://example.com/p> <https://example.com/o1> .`,
    contentType: "application/n-quads",
  });

  await worlds.import({
    source: "ns/world2",
    data:
      `<https://example.com/s> <https://example.com/p> <https://example.com/o2> .`,
    contentType: "application/n-quads",
  });

  // Query both worlds together
  const result = await worlds.sparql({
    sources: ["ns/world1", "ns/world2"],
    query:
      "SELECT ?o WHERE { <https://example.com/s> <https://example.com/p> ?o } ORDER BY ?o",
  });

  const rows = result as {
    results: { bindings: Array<{ o?: { value: string } }> };
  };
  assertEquals(rows.results.bindings.length, 2);
  assertEquals(rows.results.bindings[0].o?.value, "https://example.com/o1");
  assertEquals(rows.results.bindings[1].o?.value, "https://example.com/o2");
});

Deno.test("Worlds: multi-source query with overlapping data", async () => {
  const worlds = createWorlds();

  // Create two worlds
  await worlds.createWorld({
    namespace: "ns",
    id: "w1",
    displayName: "World 1",
  });
  await worlds.createWorld({
    namespace: "ns",
    id: "w2",
    displayName: "World 2",
  });

  // Add same triple to both worlds
  const triple =
    `<https://example.com/s> <https://example.com/p> <https://example.com/shared> .`;

  await worlds.import({
    source: "ns/w1",
    data: triple,
    contentType: "application/n-quads",
  });

  await worlds.import({
    source: "ns/w2",
    data: triple,
    contentType: "application/n-quads",
  });

  // Add unique triple to w2
  await worlds.import({
    source: "ns/w2",
    data:
      `<https://example.com/s> <https://example.com/p> <https://example.com/unique> .`,
    contentType: "application/n-quads",
  });

  // Query both worlds
  const result = await worlds.sparql({
    sources: ["ns/w1", "ns/w2"],
    query:
      "SELECT DISTINCT ?o WHERE { <https://example.com/s> <https://example.com/p> ?o } ORDER BY ?o",
  });

  const rows = result as {
    results: { bindings: Array<{ o?: { value: string } }> };
  };
  assertEquals(rows.results.bindings.length, 2);
  assertEquals(rows.results.bindings[0].o?.value, "https://example.com/shared");
  assertEquals(rows.results.bindings[1].o?.value, "https://example.com/unique");
});

Deno.test("Worlds: sparql with blank nodes", async () => {
  const worlds = createWorlds();

  await worlds.createWorld({
    namespace: "ns",
    id: "bnodeTest",
    displayName: "BNode Test",
  });

  // Import data with blank nodes
  await worlds.import({
    source: "ns/bnodeTest",
    data:
      `_:a <https://example.com/p> "Alice" .\n_:a <https://example.com/type> <https://example.com/Person> .`,
    contentType: "application/n-quads",
  });

  const result = await worlds.sparql({
    sources: ["ns/bnodeTest"],
    query: "SELECT ?s ?p ?o WHERE { ?s ?p ?o } ORDER BY ?p ?o",
  });

  const rows = result as {
    results: {
      bindings: Array<
        { s?: { value: string }; p?: { value: string }; o?: { value: string } }
      >;
    };
  };
  assertEquals(rows.results.bindings.length, 2);
  // Both triples should have the same blank node subject
  assertEquals(
    rows.results.bindings[0].s?.value,
    rows.results.bindings[1].s?.value,
  );
});

Deno.test("Worlds: sparql rejects with no sources", async () => {
  const worlds = createWorlds();

  await assertRejects(
    () => worlds.sparql({ query: "SELECT * WHERE { ?s ?p ?o }" }),
    InvalidArgumentError,
  );
});

Deno.test("Worlds: sparql rejects on non-existent world", async () => {
  const worlds = createWorlds();

  await assertRejects(
    () =>
      worlds.sparql({
        sources: ["ns/nonexistent"],
        query: "SELECT * WHERE { ?s ?p ?o }",
      }),
    WorldNotFoundError,
  );
});

Deno.test("Worlds: search finds quads matching query terms", async () => {
  const worlds = createWorlds();

  await worlds.createWorld({
    namespace: "ns",
    id: "searchTest",
    displayName: "Search Test",
  });

  await worlds.import({
    source: "ns/searchTest",
    data: `<https://example.org/ethan> <https://example.org/name> "Ethan" .
<https://example.org/ethan> <https://example.org/age> "30" .
<https://example.org/gregory> <https://example.org/name> "Gregory" .
<https://example.org/sandra> <https://example.org/name> "Sandra" .`,
    contentType: "application/n-quads",
  });

  const result = await worlds.search({
    query: "sandra",
    sources: ["ns/searchTest"],
  });

  assertEquals(result.results?.length, 1);
  assertEquals(result.results?.[0].subject, "https://example.org/sandra");
  assertEquals(result.results?.[0].predicate, "https://example.org/name");
  assertEquals(result.results?.[0].object, "Sandra");
});

Deno.test("Worlds: search scores by number of matching terms", async () => {
  const worlds = createWorlds();

  await worlds.createWorld({
    namespace: "ns",
    id: "scoreTest",
    displayName: "Score Test",
  });

  await worlds.import({
    source: "ns/scoreTest",
    data: `<https://example.org/ethan> <https://example.org/name> "Ethan" .
<https://example.org/ethan> <https://example.org/friend> "Gregory" .`,
    contentType: "application/n-quads",
  });

  const result = await worlds.search({
    query: "ethan gregory",
    sources: ["ns/scoreTest"],
  });

  assertEquals(result.results?.length, 2);
  assertEquals(result.results?.[0].ftsRank, 2);
  assertEquals(result.results?.[1].ftsRank, 1);
});

Deno.test("Worlds: search returns results from multiple worlds", async () => {
  const worlds = createWorlds();

  await worlds.createWorld({
    namespace: "ns",
    id: "world1",
    displayName: "World 1",
  });
  await worlds.createWorld({
    namespace: "ns",
    id: "world2",
    displayName: "World 2",
  });

  await worlds.import({
    source: "ns/world1",
    data: `<https://example.org/ethan> <https://example.org/name> "Ethan" .`,
    contentType: "application/n-quads",
  });
  await worlds.import({
    source: "ns/world2",
    data:
      `<https://example.org/gregory> <https://example.org/name> "Gregory" .`,
    contentType: "application/n-quads",
  });

  const result = await worlds.search({
    query: "ethan gregory",
    sources: ["ns/world1", "ns/world2"],
  });

  assertEquals(result.results?.length, 2);
});

Deno.test("Worlds: search falls back per unindexed world", async () => {
  const { worlds, chunkIndexManager } = createWorldsWithSharedOptions();

  await worlds.createWorld({
    namespace: "ns",
    id: "indexed",
    displayName: "Indexed",
  });
  await worlds.createWorld({
    namespace: "ns",
    id: "unindexed",
    displayName: "Unindexed",
  });

  await worlds.import({
    source: "ns/indexed",
    data: `<https://example.org/indexed> <https://example.org/name> "Ethan" .`,
    contentType: "application/n-quads",
  });
  await worlds.import({
    source: "ns/unindexed",
    data:
      `<https://example.org/unindexed> <https://example.org/name> "Gregory" .`,
    contentType: "application/n-quads",
  });

  await chunkIndexManager.deleteChunkIndex({
    namespace: "ns",
    id: "unindexed",
  });

  const result = await worlds.search({
    query: "ethan gregory",
    sources: ["ns/indexed", "ns/unindexed"],
  });

  assertEquals(result.results?.map((r) => r.subject).sort(), [
    "https://example.org/indexed",
    "https://example.org/unindexed",
  ]);
});

Deno.test("Worlds: search rejects on non-existent world", async () => {
  const worlds = createWorlds();

  await assertRejects(
    () =>
      worlds.search({
        query: "test",
        sources: ["ns/nonexistent"],
      }),
    WorldNotFoundError,
  );
});

Deno.test("Worlds: search with empty query returns empty", async () => {
  const worlds = createWorlds();

  await worlds.createWorld({
    namespace: "ns",
    id: "emptyQuery",
    displayName: "Empty Query",
  });
  await worlds.import({
    source: "ns/emptyQuery",
    data: `<https://example.org/s> <https://example.org/p> "o" .`,
    contentType: "application/n-quads",
  });

  const result = await worlds.search({
    query: "",
    sources: ["ns/emptyQuery"],
  });

  assertEquals(result.results?.length, 0);
});

Deno.test("Worlds: search finds data added via SPARQL UPDATE", async () => {
  const worlds = createWorlds();

  await worlds.createWorld({
    namespace: "ns",
    id: "sparqlSearch",
    displayName: "SPARQL Search",
  });

  await worlds.sparql({
    sources: ["ns/sparqlSearch"],
    query:
      `INSERT DATA { <https://example.org/person> <https://example.org/name> "Gregory" }`,
  });

  const result = await worlds.search({
    query: "gregory",
    sources: ["ns/sparqlSearch"],
  });

  assertEquals(result.results?.length, 1);
  assertEquals(result.results?.[0].subject, "https://example.org/person");
  assertEquals(result.results?.[0].predicate, "https://example.org/name");
  assertEquals(result.results?.[0].object, "Gregory");
});

Deno.test("Worlds: sparql DELETE removes from search index", async () => {
  const worlds = createWorlds();

  await worlds.createWorld({
    namespace: "ns",
    id: "deleteSearch",
    displayName: "DELETE Search",
  });

  await worlds.import({
    source: "ns/deleteSearch",
    data: `
      <https://example.org/alice> <https://example.org/name> "Alice" .
      <https://example.org/bob> <https://example.org/name> "Bob" .
    `,
    contentType: "application/n-quads",
  });

  const before = await worlds.search({
    query: "alice bob",
    sources: ["ns/deleteSearch"],
  });
  assertEquals(before.results?.length, 2);

  await worlds.sparql({
    sources: ["ns/deleteSearch"],
    query:
      `DELETE DATA { <https://example.org/alice> <https://example.org/name> "Alice" }`,
  });

  const after = await worlds.search({
    query: "alice bob",
    sources: ["ns/deleteSearch"],
  });
  assertEquals(after.results?.length, 1);
  assertEquals(after.results?.[0].subject, "https://example.org/bob");
});

Deno.test("Worlds: search filters by specified sources only", async () => {
  const worlds = createWorlds();

  await worlds.createWorld({
    namespace: "ns",
    id: "world1",
    displayName: "World 1",
  });
  await worlds.createWorld({
    namespace: "ns",
    id: "world2",
    displayName: "World 2",
  });

  await worlds.import({
    source: "ns/world1",
    data: `<https://example.org/s1> <https://example.org/p> "one" .`,
    contentType: "application/n-quads",
  });
  await worlds.import({
    source: "ns/world2",
    data: `<https://example.org/s2> <https://example.org/p> "two" .`,
    contentType: "application/n-quads",
  });

  const result1 = await worlds.search({
    query: "one two",
    sources: ["ns/world1"],
  });
  assertEquals(result1.results?.length, 1);
  assertEquals(result1.results?.[0].subject, "https://example.org/s1");

  const result2 = await worlds.search({
    query: "one two",
    sources: ["ns/world2"],
  });
  assertEquals(result2.results?.length, 1);
  assertEquals(result2.results?.[0].subject, "https://example.org/s2");
});

Deno.test("Worlds: empty sparql UPDATE does not mutate", async () => {
  const worlds = createWorlds();

  await worlds.createWorld({
    namespace: "ns",
    id: "emptyUpdate",
    displayName: "Empty UPDATE",
  });

  await worlds.import({
    source: "ns/emptyUpdate",
    data: `<https://example.org/s> <https://example.org/p> "data" .`,
    contentType: "application/n-quads",
  });

  await worlds.sparql({
    sources: ["ns/emptyUpdate"],
    query: `INSERT DATA {}`,
  });

  const result = await worlds.search({
    query: "data",
    sources: ["ns/emptyUpdate"],
  });
  assertEquals(result.results?.length, 1);
});

Deno.test("Worlds (InMemoryQuadStorageManager): sparql SELECT query", async () => {
  const worlds = createWorldsWithInMemoryQuadStorage();

  await worlds.createWorld({
    namespace: "ns",
    id: "sparqlTest",
    displayName: "SPARQL Test",
  });

  await worlds.import({
    source: "ns/sparqlTest",
    data:
      `<https://example.com/s> <https://example.com/p> <https://example.com/o> .`,
    contentType: "application/n-quads",
  });

  const result = await worlds.sparql({
    sources: ["ns/sparqlTest"],
    query:
      "SELECT ?o WHERE { <https://example.com/s> <https://example.com/p> ?o }",
  });

  const rows = result as {
    results: { bindings: Array<{ o?: { value: string } }> };
  };
  assertEquals(rows.results.bindings.length, 1);
  assertEquals(rows.results.bindings[0].o?.value, "https://example.com/o");
});

Deno.test("Worlds (InMemoryQuadStorageManager): sparql UPDATE", async () => {
  const worlds = createWorldsWithInMemoryQuadStorage();

  await worlds.createWorld({
    namespace: "ns",
    id: "updateTest",
    displayName: "UPDATE Test",
  });

  await worlds.sparql({
    sources: ["ns/updateTest"],
    query:
      `INSERT DATA { <https://example.com/s> <https://example.com/p> "value" }`,
  });

  const result = await worlds.sparql({
    sources: ["ns/updateTest"],
    query:
      "SELECT ?o WHERE { <https://example.com/s> <https://example.com/p> ?o }",
  });

  const rows = result as {
    results: { bindings: Array<{ o?: { value: string } }> };
  };
  assertEquals(rows.results.bindings.length, 1);
  assertEquals(rows.results.bindings[0].o?.value, "value");
});

Deno.test("Worlds (InMemoryQuadStorageManager): multi-world", async () => {
  const worlds = createWorldsWithInMemoryQuadStorage();

  await worlds.createWorld({ namespace: "ns", id: "w1" });
  await worlds.createWorld({ namespace: "ns", id: "w2" });

  await worlds.import({
    source: "ns/w1",
    data: `<https://example.com/s> <https://example.com/p> "one" .`,
    contentType: "application/n-quads",
  });
  await worlds.import({
    source: "ns/w2",
    data: `<https://example.com/s> <https://example.com/p> "two" .`,
    contentType: "application/n-quads",
  });

  const result = await worlds.sparql({
    sources: ["ns/w1", "ns/w2"],
    query: "SELECT DISTINCT ?o WHERE { ?s ?p ?o } ORDER BY ?o",
  });

  const rows = result as {
    results: { bindings: Array<{ o?: { value: string } }> };
  };
  assertEquals(rows.results.bindings.length, 2);
});

Deno.test("Worlds (InMemoryQuadStorageManager): isolated worlds", async () => {
  const worlds = createWorldsWithInMemoryQuadStorage();

  await worlds.createWorld({ namespace: "ns", id: "w1" });
  await worlds.createWorld({ namespace: "ns", id: "w2" });

  const triple = `<https://example.com/shared> <https://example.com/p> "v" .`;

  await worlds.import({
    source: "ns/w1",
    data: triple,
    contentType: "application/n-quads",
  });

  const r1 = await worlds.sparql({
    sources: ["ns/w1"],
    query: "SELECT * WHERE { ?s ?p ?o }",
  });
  const r1Data = r1 as unknown as { results: { bindings: [] } };
  assertEquals(r1Data.results.bindings.length, 1);

  const r2 = await worlds.sparql({
    sources: ["ns/w2"],
    query: "SELECT * WHERE { ?s ?p ?o }",
  });
  const r2Data = r2 as unknown as { results: { bindings: [] } };
  assertEquals(r2Data.results.bindings.length, 0);
});
