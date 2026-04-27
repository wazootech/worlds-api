import type { WorldReference } from "#/openapi/generated/types.gen.ts";

/**
 * StoredQuad is the internal quad representation used by the store layer.
 * Simpler than the wire format (SparqlQuad) which includes type wrappers.
 */
export interface StoredQuad {
  subject: string;
  predicate: string;
  object: string;
  graph: string;
}

/**
 * QuadStorage provides quad-level operations for a single world.
 */
export interface QuadStorage {
  add(quads: StoredQuad[]): Promise<void>;
  remove(quads: StoredQuad[]): Promise<void>;
  query(matchers: StoredQuad[]): Promise<StoredQuad[]>;
  clear(): Promise<void>;
}

/**
 * StoreStorage yields per-world stores on demand (data plane).
 * Can be in-memory, persistent, etc.
 */
export interface StoreStorage {
  getQuadStorage(reference: WorldReference): Promise<QuadStorage>;
}