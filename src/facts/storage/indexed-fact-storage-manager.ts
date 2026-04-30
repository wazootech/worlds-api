import type { WorldReference } from "#/api/openapi/generated/types.gen.ts";
import { formatWorldName } from "#/core/resolve.ts";
import type { EmbeddingsService } from "#/search/embeddings/interface.ts";
import { SearchIndexHandler } from "#/facts/storage/index/search-index-handler.ts";
import type { ChunkIndexManager } from "#/search/storage/interface.ts";
import { InMemoryFactStorage } from "#/facts/storage/in-memory.ts";
import { IndexedFactStorage } from "#/facts/storage/indexed.ts";
import type { FactStorageManager } from "./interface.ts";

export interface IndexedFactStorageManagerConfig {
  embeddings: EmbeddingsService;
  chunks: ChunkIndexManager;
}

export class IndexedFactStorageManager implements FactStorageManager {
  private readonly wrapped = new Map<string, IndexedFactStorage>();

  constructor(
    private readonly embeddings: EmbeddingsService,
    private readonly chunks: ChunkIndexManager,
  ) {}

  async getFactStorage(reference: WorldReference): Promise<IndexedFactStorage> {
    const key = formatWorldName(reference);
    let w = this.wrapped.get(key);
    if (!w) {
      const inner = new InMemoryFactStorage();
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
      w = new IndexedFactStorage(inner, [handler]);
      this.wrapped.set(key, w);
    }
    return w;
  }

  async deleteFactStorage(reference: WorldReference): Promise<void> {
    this.wrapped.delete(formatWorldName(reference));
    await this.chunks.deleteChunkIndex(reference);
  }
}
