import type { StoredQuad } from "./types.ts";
export type { StoredQuad };

export interface QuadStorage {
  add(quads: StoredQuad[]): Promise<void>;
  remove(quads: StoredQuad[]): Promise<void>;
  query(matchers: StoredQuad[]): Promise<StoredQuad[]>;
  clear(): Promise<void>;
}
