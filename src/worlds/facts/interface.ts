import type { EmbeddingsService } from "#/worlds/embeddings/interface.ts";
import type { ChunkStorage } from "#/worlds/search/chunks/interface.ts";
import type { FactStorage } from "#/worlds/rdf/facts/interface.ts";
import type { WorldReference } from "#/openapi/generated/types.gen.ts";

export interface FactStorageConfig {
  embeddings?: EmbeddingsService | null;
  chunks?: ChunkStorage | null;
}

export interface FactStorageManager {
  getFactStorage(reference: WorldReference): Promise<FactStorage>;
  deleteFactStorage(reference: WorldReference): Promise<void>;
}
