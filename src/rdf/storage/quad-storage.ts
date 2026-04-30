import type { EmbeddingsService } from "#/indexing/embeddings/interface.ts";
import type { ChunkIndexManager } from "#/indexing/storage/interface.ts";
import type { WorldReference } from "#/api/openapi/generated/types.gen.ts";
import type { StoredQuad } from "./quad.ts";

export type { StoredQuad };

export interface QuadStorage {
  setQuad(quad: StoredQuad): Promise<void>;
  deleteQuad(quad: StoredQuad): Promise<void>;
  setQuads(quads: StoredQuad[]): Promise<void>;
  deleteQuads(quads: StoredQuad[]): Promise<void>;
  findQuads(matchers: StoredQuad[]): Promise<StoredQuad[]>;
  clear(): Promise<void>;
}

export interface QuadStorageConfig {
  embeddings?: EmbeddingsService | null;
  chunks?: ChunkIndexManager | null;
}

export interface QuadStorageManager {
  getQuadStorage(reference: WorldReference): Promise<QuadStorage>;
  deleteQuadStorage(reference: WorldReference): Promise<void>;
}
