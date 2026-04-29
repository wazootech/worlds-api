import { assertEquals } from "@std/assert";
import { FakeEmbeddingsService } from "#/search/embeddings/fake.ts";
import { InMemoryChunkStorage } from "#/search/storage/in-memory.ts";
import { SearchIndexHandler } from "./search-index-handler.ts";
import type { StoredFact } from "#/facts/storage/types.ts";

function setup() {
  const embeddings = new FakeEmbeddingsService();
  const chunks = new InMemoryChunkStorage();
  const world = { namespace: "ns", id: "w1" };
  const handler = new SearchIndexHandler(embeddings, chunks, world);
  return { handler, chunks, world };
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
  const { handler, chunks, world } = setup();

  await handler.patch([{
    insertions: [makeFact({ object: "Alice is a developer" })],
    deletions: [],
  }]);

  const result = await chunks.getByWorld(world);
  assertEquals(result.length, 1);
  assertEquals(result[0].text, "Alice is a developer");
  assertEquals(result[0].subject, "https://example.org/s");
  assertEquals(result[0].predicate, "https://example.org/p");
});

Deno.test("SearchIndexHandler: skips NamedNode objects", async () => {
  const { handler, chunks, world } = setup();

  await handler.patch([{
    insertions: [makeFact({
      object: "https://example.org/other",
      objectTermType: "NamedNode",
    })],
    deletions: [],
  }]);

  const result = await chunks.getByWorld(world);
  assertEquals(result.length, 0);
});

Deno.test("SearchIndexHandler: skips BlankNode objects", async () => {
  const { handler, chunks, world } = setup();

  await handler.patch([{
    insertions: [makeFact({
      object: "_:b0",
      objectTermType: "BlankNode",
    })],
    deletions: [],
  }]);

  const result = await chunks.getByWorld(world);
  assertEquals(result.length, 0);
});

Deno.test("SearchIndexHandler: indexes rdf:type triples", async () => {
  const { handler, chunks, world } = setup();

  await handler.patch([{
    insertions: [makeFact({
      predicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      object: "https://example.org/Person",
    })],
    deletions: [],
  }]);

  const result = await chunks.getByWorld(world);
  assertEquals(result.length, 1);
  assertEquals(result[0].text, "https://example.org/Person");
});

Deno.test("SearchIndexHandler: skips meta predicates (rdfs:label, rdfs:comment)", async () => {
  const { handler, chunks, world } = setup();

  await handler.patch([{
    insertions: [
      makeFact({ predicate: "http://www.w3.org/2000/01/rdf-schema#label", object: "My Label" }),
      makeFact({ predicate: "http://www.w3.org/2000/01/rdf-schema#comment", object: "My Comment", subject: "https://example.org/s2" }),
    ],
    deletions: [],
  }]);

  const result = await chunks.getByWorld(world);
  assertEquals(result.length, 0);
});

Deno.test("SearchIndexHandler: skips empty object", async () => {
  const { handler, chunks, world } = setup();

  await handler.patch([{
    insertions: [makeFact({ object: "" })],
    deletions: [],
  }]);

  const result = await chunks.getByWorld(world);
  assertEquals(result.length, 0);
});

Deno.test("SearchIndexHandler: deletion removes chunks", async () => {
  const { handler, chunks, world } = setup();
  const fact = makeFact({ object: "Some text" });

  await handler.patch([{ insertions: [fact], deletions: [] }]);
  assertEquals((await chunks.getByWorld(world)).length, 1);

  await handler.patch([{ insertions: [], deletions: [fact] }]);
  assertEquals((await chunks.getByWorld(world)).length, 0);
});

Deno.test("SearchIndexHandler: marks world indexed after patch", async () => {
  const { handler, chunks, world } = setup();

  assertEquals(await chunks.getIndexState(world), null);

  await handler.patch([{
    insertions: [makeFact()],
    deletions: [],
  }]);

  const state = await chunks.getIndexState(world);
  assertEquals(state !== null, true);
  assertEquals(state!.embeddingDimensions, 384); // FakeEmbeddingsService.dimensions = 384
});
