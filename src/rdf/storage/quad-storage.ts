import type { EmbeddingsService } from "#/indexing/embeddings/interface.ts";
import type { ChunkIndexManager } from "#/indexing/storage/interface.ts";
import type { WorldReference } from "#/api/openapi/generated/types.gen.ts";
import type { StoredQuad } from "./quad.ts";

export type { StoredQuad };

/**
 * QuadStorage manages quads for a single world.
 *
 * Invariants:
 * - Quad identity is based on storedQuadKey (subject+predicate+object+graph).
 * - setQuad/setQuads: duplicate quads (by key) are silently ignored (idempotent).
 * - deleteQuad/deleteQuads: missing quads are silently ignored (idempotent).
 * - clear(): removes all quads for this world only; is idempotent.
 * - findQuads([]): returns all quads in this world.
 */
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

/**
 * QuadStorageManager manages QuadStorage instances by world reference.
 *
 * Invariants:
 * - getQuadStorage(ref): returns the same QuadStorage instance for the same ref (cached).
 * - deleteQuadStorage(ref): is idempotent; deleting a non-existent world is a no-op.
 */
export interface QuadStorageManager {
  getQuadStorage(reference: WorldReference): Promise<QuadStorage>;
  deleteQuadStorage(reference: WorldReference): Promise<void>;
}
