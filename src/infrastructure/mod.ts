export type { EmbeddingsService } from "#/infrastructure/embeddings/interface.ts";
export { PlaceholderEmbeddingsService } from "#/infrastructure/embeddings/placeholder.ts";

export type { ChunkRecord } from "#/infrastructure/chunks/types.ts";
export type { ChunkStorage } from "#/infrastructure/chunks/interface.ts";
export { InMemoryChunkStorage } from "#/infrastructure/chunks/in-memory.ts";

export type { Patch, PatchHandler } from "#/infrastructure/rdf/patch/types.ts";
export {
  skolemizeStoredQuad,
  storedQuadToN3,
} from "#/infrastructure/rdf/patch/skolem.ts";
export { SearchIndexHandler } from "#/infrastructure/rdf/patch/search-index-handler.ts";
export {
  META_PREDICATES,
  RDF_TYPE,
  RDFS_COMMENT,
  RDFS_LABEL,
} from "#/worlds/rdf/vocab.ts";
export { splitTextRecursive } from "#/infrastructure/rdf/patch/text-splitter.ts";

export {
  type ChunkSearchDeps,
  searchChunks,
} from "#/infrastructure/search/chunks-search-engine.ts";
