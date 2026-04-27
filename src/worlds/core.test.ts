import { assertEquals, assertRejects } from "@std/assert";
import { WorldsCore } from "./core.ts";
import { InMemoryWorldStorage } from "./store/worlds/in-memory.ts";
import { InMemoryStoreStorage } from "./store/store/in-memory.ts";

function createCore() {
  return new WorldsCore(
    new InMemoryWorldStorage(),
    new InMemoryStoreStorage(),
  );
}

Deno.test("WorldsCore: create/get/update/delete world", async () => {
  const core = createCore();

  const created = await core.createWorld({
    namespace: "ns",
    id: "w1",
    displayName: "World 1",
    description: "desc",
  });
  assertEquals(created.name, "ns/w1");
  assertEquals(created.namespace, "ns");
  assertEquals(created.id, "w1");
  assertEquals(created.displayName, "World 1");

  const fetched = await core.getWorld({ source: "ns/w1" });
  assertEquals(fetched?.name, "ns/w1");

  const updated = await core.updateWorld({
    source: { namespace: "ns", id: "w1" },
    displayName: "World One",
  });
  assertEquals(updated.displayName, "World One");
  assertEquals(updated.description, "desc");

  await core.deleteWorld({ source: "ns/w1" });
  const afterDelete = await core.getWorld({ source: "ns/w1" });
  assertEquals(afterDelete, null);
});

Deno.test("WorldsCore: createWorld rejects duplicates", async () => {
  const core = createCore();
  await core.createWorld({ namespace: "ns", id: "w1" });
  await assertRejects(
    () => core.createWorld({ namespace: "ns", id: "w1" }),
    Error,
    "World already exists",
  );
});

Deno.test("WorldsCore: sparql SELECT query on world", async () => {
  const core = createCore();

  await core.createWorld({ namespace: "ns", id: "sparqlTest", displayName: "SPARQL Test" });

  const nquads = `<https://example.com/s> <https://example.com/p> <https://example.com/o1> .\n` +
    `<https://example.com/s> <https://example.com/p> <https://example.com/o2> .`;

  await core.import({
    source: "ns/sparqlTest",
    data: nquads,
    contentType: "application/n-quads",
  });

  const result = await core.sparql({
    sources: ["ns/sparqlTest"],
    query: "SELECT ?o WHERE { <https://example.com/s> <https://example.com/p> ?o } ORDER BY ?o",
  });

  const rows = result as { results: { bindings: Array<{ o?: { value: string } }> } };
  assertEquals(rows.results.bindings.length, 2);
  assertEquals(rows.results.bindings[0].o?.value, "https://example.com/o1");
  assertEquals(rows.results.bindings[1].o?.value, "https://example.com/o2");
});

Deno.test("WorldsCore: sparql ASK query returns true", async () => {
  const core = createCore();

  await core.createWorld({ namespace: "ns", id: "askTest", displayName: "ASK Test" });

  await core.import({
    source: "ns/askTest",
    data: `<https://example.com/s> <https://example.com/p> <https://example.com/o> .`,
    contentType: "application/n-quads",
  });

  const result = await core.sparql({
    sources: ["ns/askTest"],
    query: "ASK { <https://example.com/s> <https://example.com/p> <https://example.com/o> }",
  });

  assertEquals((result as { boolean: boolean }).boolean, true);
});

Deno.test("WorldsCore: sparql ASK query returns false", async () => {
  const core = createCore();

  await core.createWorld({ namespace: "ns", id: "askTest2", displayName: "ASK Test 2" });

  await core.import({
    source: "ns/askTest2",
    data: `<https://example.com/s> <https://example.com/p> <https://example.com/o> .`,
    contentType: "application/n-quads",
  });

  const result = await core.sparql({
    sources: ["ns/askTest2"],
    query: "ASK { <https://example.com/s> <https://example.com/p> <https://example.com/o2> }",
  });

  assertEquals((result as { boolean: boolean }).boolean, false);
});

Deno.test("WorldsCore: sparql UPDATE INSERT adds triples", async () => {
  const core = createCore();

  await core.createWorld({ namespace: "ns", id: "updateTest", displayName: "UPDATE Test" });

  // Insert a triple using SPARQL UPDATE
  await core.sparql({
    sources: ["ns/updateTest"],
    query: `INSERT DATA { <https://example.com/s> <https://example.com/p> <https://example.com/o1> }`,
  });

  // Verify the triple was added
  const result = await core.sparql({
    sources: ["ns/updateTest"],
    query: "SELECT ?o WHERE { <https://example.com/s> <https://example.com/p> ?o }",
  });

  const rows = result as { results: { bindings: Array<{ o?: { value: string } }> } };
  assertEquals(rows.results.bindings.length, 1);
  assertEquals(rows.results.bindings[0].o?.value, "https://example.com/o1");
});

Deno.test("WorldsCore: sparql UPDATE DELETE removes triples", async () => {
  const core = createCore();

  await core.createWorld({ namespace: "ns", id: "deleteTest", displayName: "DELETE Test" });

  // First insert some data
  await core.import({
    source: "ns/deleteTest",
    data: `<https://example.com/s> <https://example.com/p> <https://example.com/o1> .\n` +
      `<https://example.com/s> <https://example.com/p> <https://example.com/o2> .`,
    contentType: "application/n-quads",
  });

  // Verify we have 2 triples
  let result = await core.sparql({
    sources: ["ns/deleteTest"],
    query: "SELECT ?o WHERE { <https://example.com/s> <https://example.com/p> ?o } ORDER BY ?o",
  });

  let rows = result as { results: { bindings: Array<{ o?: { value: string } }> } };
  assertEquals(rows.results.bindings.length, 2);

  // Delete one triple
  await core.sparql({
    sources: ["ns/deleteTest"],
    query: `DELETE DATA { <https://example.com/s> <https://example.com/p> <https://example.com/o1> }`,
  });

  // Verify only one remains
  result = await core.sparql({
    sources: ["ns/deleteTest"],
    query: "SELECT ?o WHERE { <https://example.com/s> <https://example.com/p> ?o } ORDER BY ?o",
  });

  rows = result as { results: { bindings: Array<{ o?: { value: string } }> } };
  assertEquals(rows.results.bindings.length, 1);
  assertEquals(rows.results.bindings[0].o?.value, "https://example.com/o2");
});

Deno.test("WorldsCore: sparql UPDATE INSERT+DELETE combination", async () => {
  const core = createCore();

  await core.createWorld({ namespace: "ns", id: "comboTest", displayName: "Combo Test" });

  // Insert initial data
  await core.import({
    source: "ns/comboTest",
    data: `<https://example.com/s> <https://example.com/p> <https://example.com/o1> .`,
    contentType: "application/n-quads",
  });

  // Replace o1 with o2 using INSERT+DELETE
  await core.sparql({
    sources: ["ns/comboTest"],
    query: `
      DELETE { <https://example.com/s> <https://example.com/p> <https://example.com/o1> }
      INSERT { <https://example.com/s> <https://example.com/p> <https://example.com/o2> }
      WHERE { <https://example.com/s> <https://example.com/p> <https://example.com/o1> }
    `,
  });

  const result = await core.sparql({
    sources: ["ns/comboTest"],
    query: "SELECT ?o WHERE { <https://example.com/s> <https://example.com/p> ?o }",
  });

  const rows = result as { results: { bindings: Array<{ o?: { value: string } }> } };
  assertEquals(rows.results.bindings.length, 1);
  assertEquals(rows.results.bindings[0].o?.value, "https://example.com/o2");
});

Deno.test("WorldsCore: multi-source sparql query unions multiple worlds", async () => {
  const core = createCore();

  // Create two worlds
  await core.createWorld({ namespace: "ns", id: "world1", displayName: "World 1" });
  await core.createWorld({ namespace: "ns", id: "world2", displayName: "World 2" });

  // Add different data to each world
  await core.import({
    source: "ns/world1",
    data: `<https://example.com/s> <https://example.com/p> <https://example.com/o1> .`,
    contentType: "application/n-quads",
  });

  await core.import({
    source: "ns/world2",
    data: `<https://example.com/s> <https://example.com/p> <https://example.com/o2> .`,
    contentType: "application/n-quads",
  });

  // Query both worlds together
  const result = await core.sparql({
    sources: ["ns/world1", "ns/world2"],
    query: "SELECT ?o WHERE { <https://example.com/s> <https://example.com/p> ?o } ORDER BY ?o",
  });

  const rows = result as { results: { bindings: Array<{ o?: { value: string } }> } };
  assertEquals(rows.results.bindings.length, 2);
  assertEquals(rows.results.bindings[0].o?.value, "https://example.com/o1");
  assertEquals(rows.results.bindings[1].o?.value, "https://example.com/o2");
});

Deno.test("WorldsCore: multi-source query with overlapping data", async () => {
  const core = createCore();

  // Create two worlds
  await core.createWorld({ namespace: "ns", id: "w1", displayName: "World 1" });
  await core.createWorld({ namespace: "ns", id: "w2", displayName: "World 2" });

  // Add same triple to both worlds
  const triple = `<https://example.com/s> <https://example.com/p> <https://example.com/shared> .`;

  await core.import({
    source: "ns/w1",
    data: triple,
    contentType: "application/n-quads",
  });

  await core.import({
    source: "ns/w2",
    data: triple,
    contentType: "application/n-quads",
  });

  // Add unique triple to w2
  await core.import({
    source: "ns/w2",
    data: `<https://example.com/s> <https://example.com/p> <https://example.com/unique> .`,
    contentType: "application/n-quads",
  });

  // Query both worlds
  const result = await core.sparql({
    sources: ["ns/w1", "ns/w2"],
    query: "SELECT DISTINCT ?o WHERE { <https://example.com/s> <https://example.com/p> ?o } ORDER BY ?o",
  });

  const rows = result as { results: { bindings: Array<{ o?: { value: string } }> } };
  assertEquals(rows.results.bindings.length, 2);
  assertEquals(rows.results.bindings[0].o?.value, "https://example.com/shared");
  assertEquals(rows.results.bindings[1].o?.value, "https://example.com/unique");
});

Deno.test("WorldsCore: sparql with blank nodes", async () => {
  const core = createCore();

  await core.createWorld({ namespace: "ns", id: "bnodeTest", displayName: "BNode Test" });

  // Import data with blank nodes
  await core.import({
    source: "ns/bnodeTest",
    data: `_:a <https://example.com/p> "Alice" .\n_:a <https://example.com/type> <https://example.com/Person> .`,
    contentType: "application/n-quads",
  });

  const result = await core.sparql({
    sources: ["ns/bnodeTest"],
    query: "SELECT ?s ?p ?o WHERE { ?s ?p ?o } ORDER BY ?p ?o",
  });

  const rows = result as { results: { bindings: Array<{ s?: { value: string }; p?: { value: string }; o?: { value: string } }> } };
  assertEquals(rows.results.bindings.length, 2);
  // Both triples should have the same blank node subject
  assertEquals(rows.results.bindings[0].s?.value, rows.results.bindings[1].s?.value);
});

Deno.test("WorldsCore: sparql rejects with no sources", async () => {
  const core = createCore();

  await assertRejects(
    () => core.sparql({ query: "SELECT * WHERE { ?s ?p ?o }" }),
    Error,
    "sparql requires at least one source",
  );
});

Deno.test("WorldsCore: sparql rejects on non-existent world", async () => {
  const core = createCore();

  await assertRejects(
    () => core.sparql({ sources: ["ns/nonexistent"], query: "SELECT * WHERE { ?s ?p ?o }" }),
    Error,
    "World not found",
  );
});
