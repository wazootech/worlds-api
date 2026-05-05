/**
 * Pluggable embedding generation for semantic search.
 */
export interface EmbeddingsService {
  /** Vector dimensionality produced by {@link embed}. */
  readonly dimensions: number;

  /** Embed a single string. */
  embed(text: string): Promise<number[]>;

  /**
   * Embed multiple strings in a single request.
   * Efficient for high-volume indexing (e.g. quad imports).
   */
  embedBatch(texts: string[]): Promise<number[][]>;
}
