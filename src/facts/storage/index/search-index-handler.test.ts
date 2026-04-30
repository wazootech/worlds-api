import { assertEquals } from "@std/assert";
import { FakeEmbeddingsService } from "#/search/embeddings/fake.ts";
import { InMemoryChunkIndexManager } from "#/search/storage/in-memory.ts";
import { SearchIndexHandler } from "./search-index-handler.ts";
import type { StoredFact } from "#/facts/storage/types.ts";

async function setup() {
  const embeddings = new FakeEmbeddingsService();
  const chunkIndexManager = new InMemoryChunkIndexManager();
  const world = { namespace: "ns", id: "w1" };
  await chunkIndexManager.setIndexState({
    world,
    indexedAt: Date.now(),
    embeddingDimensions: embeddings.dimensions,
  });
  const index = await chunkIndexManager.getChunkIndex(world);
  const handler = new SearchIndexHandler(embeddings, index, world);
  return { handler, chunkIndexManager, index, world };
}

function makeFact(overrides: Partial<StoredFact> = {}): StoredFact {
  return {
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    object: "Hello world",
    graph: "",
    ...overrides,
  };
}

Deno.test("SearchIndexHandler: indexes literal object", async () => {
  const { handler, index } = await setup();

  await handler.patch([{
    insertions: [makeFact({ object: "Alice is a developer" })],
    deletions: [],
  }]);

  const result = await index.getAll();
  assertEquals(result.length, 1);
  assertEquals(result[0].text, "Alice is a developer");
  assertEquals(result[0].subject, "https://example.org/s");
  assertEquals(result[0].predicate, "https://example.org/p");
});

Deno.test("SearchIndexHandler: skips NamedNode objects", async () => {
  const { handler, index } = await setup();

  await handler.patch([{
    insertions: [makeFact({
      object: "https://example.org/other",
      objectTermType: "NamedNode",
    })],
    deletions: [],
  }]);

  const result = await index.getAll();
  assertEquals(result.length, 0);
});

Deno.test("SearchIndexHandler: skips IRI-shaped objects without objectTermType", async () => {
  const { handler, index } = await setup();

  await handler.patch([{
    insertions: [makeFact({
      object: "urn:example:thing",
      // objectTermType intentionally omitted; `storedFactToN3` infers NamedNode.
    })],
    deletions: [],
  }]);

  const result = await index.getAll();
  assertEquals(result.length, 0);
});

Deno.test("SearchIndexHandler: skips BlankNode objects", async () => {
  const { handler, index } = await setup();

  await handler.patch([{
    insertions: [makeFact({
      object: "_:b0",
      objectTermType: "BlankNode",
    })],
    deletions: [],
  }]);

  const result = await index.getAll();
  assertEquals(result.length, 0);
});

Deno.test("SearchIndexHandler: skips blank node objects without objectTermType", async () => {
  const { handler, index } = await setup();

  await handler.patch([{
    insertions: [makeFact({
      object: "_:b0",
      // objectTermType intentionally omitted; `storedFactToN3` infers BlankNode.
    })],
    deletions: [],
  }]);

  const result = await index.getAll();
  assertEquals(result.length, 0);
});

Deno.test("SearchIndexHandler: skips rdf:type triples (object is typically an IRI)", async () => {
  const { handler, index } = await setup();

  await handler.patch([{
    insertions: [makeFact({
      predicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      object: "https://example.org/Person",
    })],
    deletions: [],
  }]);

  const result = await index.getAll();
  assertEquals(result.length, 0);
});

Deno.test("SearchIndexHandler: skips meta predicates (rdfs:label, rdfs:comment)", async () => {
  const { handler, index } = await setup();

  await handler.patch([{
    insertions: [
      makeFact({
        predicate: "http://www.w3.org/2000/01/rdf-schema#label",
        object: "My Label",
      }),
      makeFact({
        predicate: "http://www.w3.org/2000/01/rdf-schema#comment",
        object: "My Comment",
        subject: "https://example.org/s2",
      }),
    ],
    deletions: [],
  }]);

  const result = await index.getAll();
  assertEquals(result.length, 0);
});

Deno.test("SearchIndexHandler: skips empty object", async () => {
  const { handler, index } = await setup();

  await handler.patch([{
    insertions: [makeFact({ object: "" })],
    deletions: [],
  }]);

  const result = await index.getAll();
  assertEquals(result.length, 0);
});

Deno.test("SearchIndexHandler: deletion removes chunks", async () => {
  const { handler, index } = await setup();
  const fact = makeFact({ object: "Some text" });

  await handler.patch([{ insertions: [fact], deletions: [] }]);
  assertEquals((await index.getAll()).length, 1);

  await handler.patch([{ insertions: [], deletions: [fact] }]);
  assertEquals((await index.getAll()).length, 0);
});

Deno.test("SearchIndexHandler: does not mutate index state", async () => {
  const { handler, chunkIndexManager, world } = await setup();
  const before = await chunkIndexManager.getIndexState(world);

  await handler.patch([{
    insertions: [makeFact()],
    deletions: [],
  }]);

  const after = await chunkIndexManager.getIndexState(world);
  assertEquals(after, before);
});
