import type { EmbeddingsService } from "#/indexing/embeddings/interface.ts";
import type { ChunkIndexManager } from "#/indexing/storage/interface.ts";
import type { WorldReference } from "#/api/openapi/generated/types.gen.ts";
import type { StoredFact } from "./types.ts";

export type { StoredFact };

export interface FactStorage {
  setFact(fact: StoredFact): Promise<void>;
  deleteFact(fact: StoredFact): Promise<void>;
  setFacts(facts: StoredFact[]): Promise<void>;
  deleteFacts(facts: StoredFact[]): Promise<void>;
  findFacts(matchers: StoredFact[]): Promise<StoredFact[]>;
  clear(): Promise<void>;
}

export interface FactStorageConfig {
  embeddings?: EmbeddingsService | null;
  chunks?: ChunkIndexManager | null;
}

export interface FactStorageManager {
  getFactStorage(reference: WorldReference): Promise<FactStorage>;
  deleteFactStorage(reference: WorldReference): Promise<void>;
}
