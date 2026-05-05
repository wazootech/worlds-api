import { assertEquals } from "@std/assert";
import { FakeEmbeddingsService } from "#/indexing/embeddings/fake.ts";
import { InMemoryChunkIndexManager } from "#/indexing/storage/in-memory.ts";
import {
  type ChunkingRule,
  SearchIndexHandler,
} from "./handler.ts";
import type { StoredQuad } from "#/rdf/storage/types.ts";

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

function makeQuad(overrides: Partial<StoredQuad> = {}): StoredQuad {
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
    insertions: [makeQuad({ object: "Alice is a developer" })],
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
    insertions: [makeQuad({
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
    insertions: [makeQuad({
      object: "urn:example:thing",
      // objectTermType intentionally omitted; `storedQuadToN3` infers NamedNode.
    })],
    deletions: [],
  }]);

  const result = await index.getAll();
  assertEquals(result.length, 0);
});

Deno.test("SearchIndexHandler: skips BlankNode objects", async () => {
  const { handler, index } = await setup();

  await handler.patch([{
    insertions: [makeQuad({
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
    insertions: [makeQuad({
      object: "_:b0",
      // objectTermType intentionally omitted; `storedQuadToN3` infers BlankNode.
    })],
    deletions: [],
  }]);

  const result = await index.getAll();
  assertEquals(result.length, 0);
});

Deno.test("SearchIndexHandler: skips rdf:type triples (object is typically an IRI)", async () => {
  const { handler, index } = await setup();

  await handler.patch([{
    insertions: [makeQuad({
      predicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      object: "https://example.org/Person",
    })],
    deletions: [],
  }]);

  const result = await index.getAll();
  assertEquals(result.length, 0);
});

Deno.test("SearchIndexHandler: indexes meta predicates by default (rdfs:label, rdfs:comment)", async () => {
  const { handler, index } = await setup();

  await handler.patch([{
    insertions: [
      makeQuad({
        predicate: "http://www.w3.org/2000/01/rdf-schema#label",
        object: "My Label",
      }),
      makeQuad({
        predicate: "http://www.w3.org/2000/01/rdf-schema#comment",
        object: "My Comment",
        subject: "https://example.org/s2",
      }),
    ],
    deletions: [],
  }]);

  const result = await index.getAll();
  assertEquals(result.length, 2);
  assertEquals(
    result[0].predicate,
    "http://www.w3.org/2000/01/rdf-schema#label",
  );
  assertEquals(
    result[1].predicate,
    "http://www.w3.org/2000/01/rdf-schema#comment",
  );
});

Deno.test("SearchIndexHandler: skips empty object", async () => {
  const { handler, index } = await setup();

  await handler.patch([{
    insertions: [makeQuad({ object: "" })],
    deletions: [],
  }]);

  const result = await index.getAll();
  assertEquals(result.length, 0);
});

Deno.test("SearchIndexHandler: deletion removes chunks", async () => {
  const { handler, index } = await setup();
  const quad = makeQuad({ object: "Some text" });

  await handler.patch([{ insertions: [quad], deletions: [] }]);
  assertEquals((await index.getAll()).length, 1);

  await handler.patch([{ insertions: [], deletions: [quad] }]);
  assertEquals((await index.getAll()).length, 0);
});

Deno.test("SearchIndexHandler: does not mutate index state", async () => {
  const { handler, chunkIndexManager, world } = await setup();
  const before = await chunkIndexManager.getIndexState(world);

  await handler.patch([{
    insertions: [makeQuad()],
    deletions: [],
  }]);

  const after = await chunkIndexManager.getIndexState(world);
  assertEquals(after, before);
});

Deno.test("SearchIndexHandler: opt-out rdfs:label via index:false", async () => {
  const embeddings = new FakeEmbeddingsService();
  const chunkIndexManager = new InMemoryChunkIndexManager();
  const world = { namespace: "ns", id: "w1" };
  await chunkIndexManager.setIndexState({
    world,
    indexedAt: Date.now(),
    embeddingDimensions: embeddings.dimensions,
  });
  const index = await chunkIndexManager.getChunkIndex(world);

  const rules: ChunkingRule[] = [{
    predicates: ["http://www.w3.org/2000/01/rdf-schema#label"],
    index: false,
  }];
  const handler = new SearchIndexHandler(embeddings, index, world, rules);

  await handler.patch([{
    insertions: [makeQuad({
      predicate: "http://www.w3.org/2000/01/rdf-schema#label",
      object: "Should not be indexed",
    })],
    deletions: [],
  }]);

  const result = await index.getAll();
  assertEquals(result.length, 0);
});

Deno.test("SearchIndexHandler: opt-out rdfs:comment with noSplit", async () => {
  const embeddings = new FakeEmbeddingsService();
  const chunkIndexManager = new InMemoryChunkIndexManager();
  const world = { namespace: "ns", id: "w1" };
  await chunkIndexManager.setIndexState({
    world,
    indexedAt: Date.now(),
    embeddingDimensions: embeddings.dimensions,
  });
  const index = await chunkIndexManager.getChunkIndex(world);

  const rules: ChunkingRule[] = [{
    predicates: ["http://www.w3.org/2000/01/rdf-schema#comment"],
    index: false,
    noSplit: true,
  }];
  const handler = new SearchIndexHandler(embeddings, index, world, rules);

  await handler.patch([{
    insertions: [makeQuad({
      predicate: "http://www.w3.org/2000/01/rdf-schema#comment",
      object: "Should not be indexed",
      subject: "https://example.org/s2",
    })],
    deletions: [],
  }]);

  const result = await index.getAll();
  assertEquals(result.length, 0);
});

Deno.test("SearchIndexHandler: rule noSplit preserves long text as single chunk", async () => {
  const embeddings = new FakeEmbeddingsService();
  const chunkIndexManager = new InMemoryChunkIndexManager();
  const world = { namespace: "ns", id: "w1" };
  await chunkIndexManager.setIndexState({
    world,
    indexedAt: Date.now(),
    embeddingDimensions: embeddings.dimensions,
  });
  const index = await chunkIndexManager.getChunkIndex(world);

  const rules: ChunkingRule[] = [{
    predicates: ["https://example.org/p"],
    noSplit: true,
  }];
  const handler = new SearchIndexHandler(embeddings, index, world, rules);

  const longText =
    "This is a long text that would normally be split into multiple chunks but with noSplit it stays as one.";
  await handler.patch([{
    insertions: [makeQuad({ object: longText })],
    deletions: [],
  }]);

  const result = await index.getAll();
  assertEquals(result.length, 1);
  assertEquals(result[0].text, longText);
});

Deno.test("SearchIndexHandler: rule index:false overrides default", async () => {
  const embeddings = new FakeEmbeddingsService();
  const chunkIndexManager = new InMemoryChunkIndexManager();
  const world = { namespace: "ns", id: "w1" };
  await chunkIndexManager.setIndexState({
    world,
    indexedAt: Date.now(),
    embeddingDimensions: embeddings.dimensions,
  });
  const index = await chunkIndexManager.getChunkIndex(world);

  const rules: ChunkingRule[] = [{
    predicates: ["https://example.org/p"],
    index: false,
  }];
  const handler = new SearchIndexHandler(embeddings, index, world, rules);

  await handler.patch([{
    insertions: [makeQuad({ object: "Should not be indexed" })],
    deletions: [],
  }]);

  const result = await index.getAll();
  assertEquals(result.length, 0);
});
