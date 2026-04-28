import type { StoredQuad } from "./types.ts";
export type { StoredQuad };

export interface QuadStorage {
  setQuad(quad: StoredQuad): Promise<void>;
  deleteQuad(quad: StoredQuad): Promise<void>;
  setQuads(quads: StoredQuad[]): Promise<void>;
  deleteQuads(quads: StoredQuad[]): Promise<void>;
  findQuads(matchers: StoredQuad[]): Promise<StoredQuad[]>;
  clear(): Promise<void>;
}
