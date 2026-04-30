/**
 * Pluggable embedding generation for semantic search.
 */
export interface EmbeddingsService {
  /** Vector dimensionality produced by {@link embed}. */
  readonly dimensions: number;

  embed(text: string): Promise<number[]>;
}
