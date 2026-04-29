import type { EmbeddingsService } from "./interface.ts";

const DIM = 384;

function normalize(vec: number[]): number[] {
  let sum = 0;
  for (const x of vec) sum += x * x;
  const n = Math.sqrt(sum) || 1;
  return vec.map((x) => x / n);
}

/**
 * Deterministic pseudo-embeddings for development and tests.
 * Same input yields the same unit-length vector; no external API.
 *
 * @deprecated Use a real EmbeddingsService implementation for production.
 * @deprecated Use InMemoryFactStorageManager for SPARQL-only worlds without search.
 */
export class NoopEmbeddingsService implements EmbeddingsService {
  readonly dimensions = DIM;

  async embed(text: string): Promise<number[]> {
    const vec = new Array<number>(DIM).fill(0);
    let h = hashString(text);
    for (let i = 0; i < DIM; i++) {
      h = Math.imul(h ^ (h >>> 13), 0xcc9e2d51);
      h ^= h >>> 16;
      vec[i] = ((h >>> 0) / 0xffffffff) * 2 - 1;
    }
    return normalize(vec);
  }
}

/**
 * @deprecated Use NoopEmbeddingsService instead.
 */
export { NoopEmbeddingsService as PlaceholderEmbeddingsService };

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
