import type { StoredQuad } from "./stored-quad.ts";

/**
 * QuadStoreInterface provides quad-level operations for a single world.
 */
export interface QuadStoreInterface {
  add(quads: StoredQuad[]): Promise<void>;
  remove(quads: StoredQuad[]): Promise<void>;
  query(quads: StoredQuad[]): Promise<StoredQuad[]>;
  clear(): Promise<void>;
}