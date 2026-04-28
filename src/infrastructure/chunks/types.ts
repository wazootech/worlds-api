import type { WorldReference } from "#/openapi/generated/types.gen.ts";

export interface ChunkRecord {
  id: string;
  factId: string;
  subject: string;
  predicate: string;
  /** Lexical form indexed for FTS / display (literal or URI string). */
  text: string;
  /** Unit-length embedding; length matches {@link EmbeddingsService.dimensions}. */
  vector: Float32Array;
  world: WorldReference;
}
