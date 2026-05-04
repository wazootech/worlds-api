export { ftsTermHits, tokenizeSearchQuery } from "./fts.ts";

export type { EmbeddingsService } from "./embeddings/interface.ts";
export { FakeEmbeddingsService } from "./embeddings/fake.ts";
export type { OpenAIEmbeddingsConfig } from "./embeddings/openai.ts";
export { OpenAIEmbeddingsService } from "./embeddings/openai.ts";

export type {
  ChunkIndex,
  ChunkIndexManager,
  ChunkIndexSearchQuery,
  ChunkIndexState,
  ChunkRecord,
  ChunkSearchQuery,
  ChunkSearchRow,
} from "./storage/interface.ts";

export {
  InMemoryChunkIndex,
  InMemoryChunkIndexManager,
} from "./storage/in-memory.ts";
export { OramaChunkIndex, OramaChunkIndexManager } from "./storage/orama.ts";
