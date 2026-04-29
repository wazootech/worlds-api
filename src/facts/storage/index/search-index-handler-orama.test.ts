import { assertEquals } from "@std/assert";
import { FakeEmbeddingsService } from "#/search/embeddings/fake.ts";
import { OramaChunkIndexManager } from "#/search/storage/orama.ts";
import { SearchIndexHandler } from "./search-index-handler.ts";
import type { StoredFact } from "#/facts/storage/types.ts";

function makeFact(overrides: Partial<StoredFact> = {}): StoredFact {
  return {
    subject: "https://example.org/s",
    predicate: "https://example.org/p",
    object: "Hello world",
    graph: "",
    ...overrides,
  };
}

Deno.test("SearchIndexHandler with Orama: renders and keeps in sync", async () => {
  const embeddings = new FakeEmbeddingsService();
  const chunkIndexManager = new OramaChunkIndexManager();
  const world = { namespace: "ns", id: "orama-sync-test" };
  await chunkIndexManager.setIndexState({
    world,
    indexedAt: Date.now(),
    embeddingDimensions: embeddings.dimensions,
  });
  const index = await chunkIndexManager.getChunkIndex(world);
  const handler = new SearchIndexHandler(embeddings, index, world);

  // 1. Initial population (Insert)
  await handler.patch([{
    insertions: [
      makeFact({ subject: "s1", object: "The quick brown fox" }),
      makeFact({ subject: "s2", object: "Jumps over the lazy dog" }),
    ],
    deletions: [],
  }]);

  let results = await index.getAll();
  assertEquals(results.length, 2);

  // Verify FTS search (via SearchIndexHandler populating Orama)
  const searchRes = await index.search({
    queryText: "quick fox",
    queryTerms: ["quick", "fox"],
    queryVector: await embeddings.embed("quick fox"),
  });
  assertEquals(searchRes.length, 1);
  assertEquals(searchRes[0].chunk.subject, "s1");

  // 2. Sync (Update/Delete)
  await handler.patch([{
    insertions: [
      makeFact({ subject: "s3", object: "Fresh data" }),
    ],
    deletions: [
      makeFact({ subject: "s1", object: "The quick brown fox" }),
    ],
  }]);

  results = await index.getAll();
  assertEquals(results.length, 2);
  const subjects = results.map((r) => r.subject).sort();
  assertEquals(subjects, ["s2", "s3"]);

  // Verify s1 is gone from search
  const searchRes2 = await index.search({
    queryText: "fox",
    queryTerms: ["fox"],
    queryVector: await embeddings.embed("fox"),
  });
  assertEquals(searchRes2.length, 0);

  // 3. Cleanup
  await chunkIndexManager.deleteChunkIndex(world);
  const afterDelete = await chunkIndexManager.getChunkIndex(world);
  assertEquals((await afterDelete.getAll()).length, 0);
});
