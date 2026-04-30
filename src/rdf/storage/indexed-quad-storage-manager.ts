import type { WorldReference } from "#/api/openapi/generated/types.gen.ts";
import { formatWorldName } from "#/core/resolve.ts";
import type { EmbeddingsService } from "#/indexing/embeddings/interface.ts";
import { SearchIndexHandler } from "#/indexing/handlers/rdf-write-indexing/search-index-handler.ts";
import type { ChunkIndexManager } from "#/indexing/storage/interface.ts";
import { InMemoryQuadStorage } from "./in-memory-quad-storage.ts";
import { IndexedQuadStorage } from "./indexed-quad-storage.ts";
import type { QuadStorageManager } from "./quad-storage.ts";

export interface IndexedQuadStorageManagerConfig {
  embeddings: EmbeddingsService;
  chunks: ChunkIndexManager;
}

export class IndexedQuadStorageManager implements QuadStorageManager {
  private readonly wrapped = new Map<string, IndexedQuadStorage>();

  constructor(
    private readonly embeddings: EmbeddingsService,
    private readonly chunks: ChunkIndexManager,
  ) {}

  async getQuadStorage(reference: WorldReference): Promise<IndexedQuadStorage> {
    const key = formatWorldName(reference);
    let w = this.wrapped.get(key);
    if (!w) {
      const inner = new InMemoryQuadStorage();
      await this.chunks.setIndexState({
        world: reference,
        indexedAt: Date.now(),
        embeddingDimensions: this.embeddings.dimensions,
      });
      const index = await this.chunks.getChunkIndex(reference);
      const handler = new SearchIndexHandler(
        this.embeddings,
        index,
        reference,
      );
      w = new IndexedQuadStorage(inner, [handler]);
      this.wrapped.set(key, w);
    }
    return w;
  }

  async deleteQuadStorage(reference: WorldReference): Promise<void> {
    this.wrapped.delete(formatWorldName(reference));
    await this.chunks.deleteChunkIndex(reference);
  }
}
