import type { WorldReference } from "#/api/openapi/generated/types.gen.ts";

export interface ChunkRecord {
  id: string;
  quadId: string;
  subject: string;
  predicate: string;
  text: string;
  vector: Float32Array;
  world: WorldReference;
}

export interface ChunkIndexState {
  world: WorldReference;
  indexedAt: number;
  embeddingDimensions: number;
  embeddingModel?: string;
}

export interface ChunkSearchQuery {
  worlds: WorldReference[];
  queryText: string;
  queryTerms: string[];
  queryVector: Float32Array | number[];
  subjects?: string[];
  predicates?: string[];
  types?: string[];
}

export interface ChunkSearchRow {
  chunk: ChunkRecord;
  vecRank: number | null;
  ftsRank: number | null;
  score: number;
}
