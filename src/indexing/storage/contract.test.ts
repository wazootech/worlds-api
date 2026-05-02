import { assertEquals, assertExists } from "@std/assert";
import type {
  ChunkIndexManager,
  ChunkIndexState,
  ChunkRecord,
} from "./interface.ts";
import type { WorldReference } from "#/api/openapi/generated/types.gen.ts";
import { FakeEmbeddingsService } from "#/indexing/embeddings/fake.ts";

/** Shared contract tests for any ChunkIndexManager implementation. */
export function testChunkIndexManager(
  name: string,
  factory: (suffix: string) => ChunkIndexManager,
) {
  const ref: WorldReference = { namespace: "ns", id: "w1" };

  Deno.test(
    `ChunkIndexManager contract [${name}]: getChunkIndex returns index for world`,
    async () => {
      const mgr = factory("contract1");
      const index = await mgr.getChunkIndex(ref);
      assertExists(index);
    },
  );

  Deno.test(
    `ChunkIndexManager contract [${name}]: setChunk adds chunk and search finds it`,
    async () => {
      const mgr = factory("contract2");
      const index = await mgr.getChunkIndex(ref);
      const chunk: ChunkRecord = {
        id: "c1",
        quadId: "q1",
        subject: "s:Subject",
        predicate: "p:predicate",
        text: "hello world",
        vector: new Float32Array(
          await new FakeEmbeddingsService().embed("hello world"),
        ),
        world: ref,
      };
      await index.setChunk(chunk);
      const results = await index.search({
        queryText: "hello",
        queryTerms: ["hello"],
        queryVector: chunk.vector,
      });
      assertEquals(results.length > 0, true);
    },
  );

  Deno.test(
    `ChunkIndexManager contract [${name}]: deleteChunk removes chunk`,
    async () => {
      const mgr = factory("contract3");
      const index = await mgr.getChunkIndex(ref);
      const chunk: ChunkRecord = {
        id: "c1",
        quadId: "q1",
        subject: "s:Subject",
        predicate: "p:predicate",
        text: "hello world",
        vector: new Float32Array(3),
        world: ref,
      };
      await index.setChunk(chunk);
      await index.deleteChunk("q1");
      const results = await index.search({
        queryText: "hello",
        queryTerms: ["hello"],
        queryVector: new Float32Array(3),
      });
      assertEquals(results.length, 0);
    },
  );

  Deno.test(
    `ChunkIndexManager contract [${name}]: getIndexState returns null before set`,
    async () => {
      const mgr = factory("contract4");
      const state = await mgr.getIndexState(ref);
      assertEquals(state, null);
    },
  );

  Deno.test(
    `ChunkIndexManager contract [${name}]: setIndexState and getIndexState`,
    async () => {
      const mgr = factory("contract5");
      const state: ChunkIndexState = {
        world: ref,
        indexedAt: Date.now(),
        embeddingDimensions: 3,
        embeddingModel: "test-model",
      };
      await mgr.setIndexState(state);
      const retrieved = await mgr.getIndexState(ref);
      assertExists(retrieved);
      assertEquals(retrieved.embeddingDimensions, 3);
      assertEquals(retrieved.embeddingModel, "test-model");
    },
  );

  Deno.test(
    `ChunkIndexManager contract [${name}]: deleteChunkIndex clears data`,
    async () => {
      const mgr = factory("contract6");
      const index = await mgr.getChunkIndex(ref);
      const chunk: ChunkRecord = {
        id: "c1",
        quadId: "q1",
        subject: "s:Subject",
        predicate: "p:predicate",
        text: "hello world",
        vector: new Float32Array(3),
        world: ref,
      };
      await index.setChunk(chunk);
      await mgr.deleteChunkIndex(ref);
      const state = await mgr.getIndexState(ref);
      assertEquals(state, null);
    },
  );
}
