import type { WorldReference } from "#/rpc/openapi/generated/types.gen.ts";
import { formatWorldName } from "#/core/resolve.ts";
import type { EmbeddingsService } from "#/indexing/embeddings/interface.ts";
import {
  type ChunkingRule,
  SearchIndexHandler,
} from "#/indexing/search/search-index-handler.ts";
import type { ChunkIndexManager } from "#/indexing/storage/interface.ts";
import { InMemoryQuadStorage } from "../in-memory/storage.ts";
import { IndexedQuadStorage } from "./storage.ts";
import type { QuadStorageManager } from "../interface.ts";

export interface IndexedQuadStorageManagerConfig {
  embeddings: EmbeddingsService;
  chunks: ChunkIndexManager;
  chunkingRules?: ChunkingRule[];
}

export class IndexedQuadStorageManager implements QuadStorageManager {
  private readonly wrapped = new Map<string, IndexedQuadStorage>();

  constructor(
    private readonly embeddings: EmbeddingsService,
    private readonly chunks: ChunkIndexManager,
    private readonly chunkingRules: ChunkingRule[] = [],
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
        this.chunkingRules,
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
